// Bruno Capture native helper — ScreenCaptureKit window capture with a line-delimited JSON protocol.
// No workflow logic lives here (PRD §61): enumerate windows, still-capture a window, record a window.
import AppKit
import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// MARK: - protocol

let stdoutLock = NSLock()
func emit(_ obj: [String: Any]) {
    stdoutLock.lock(); defer { stdoutLock.unlock() }
    guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func fail(_ code: String, _ message: String) -> Never {
    emit(["ok": false, "code": code, "message": message])
    exit(1)
}

let argv = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
    guard let i = argv.firstIndex(of: name), i + 1 < argv.count else { return nil }
    return argv[i + 1]
}
func hasFlag(_ name: String) -> Bool { argv.contains(name) }

let usage = "usage: bru-capture-helper <preflight|request|windows [--bundle id] [--pid n]|still --window id --out file.png|record --window id --out file.mov [--fps n]>"
guard let command = argv.first else { fail("usage", usage) }

// MARK: - helpers

func scaleFactor(for window: SCWindow) -> CGFloat {
    let frame = window.frame
    for screen in NSScreen.screens where screen.frame.intersects(frame) { return screen.backingScaleFactor }
    return NSScreen.main?.backingScaleFactor ?? 2
}

func findWindow(_ id: UInt32) async throws -> SCWindow {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let w = content.windows.first(where: { $0.windowID == id }) else {
        throw NSError(domain: "helper", code: 2, userInfo: [NSLocalizedDescriptionKey: "window \(id) not found"])
    }
    return w
}

func windowJSON(_ w: SCWindow) -> [String: Any] {
    return [
        "id": Int(w.windowID),
        "title": w.title ?? "",
        "frame": ["x": w.frame.origin.x, "y": w.frame.origin.y, "width": w.frame.width, "height": w.frame.height],
        "layer": w.windowLayer,
        "onScreen": w.isOnScreen,
        "app": [
            "bundleId": w.owningApplication?.bundleIdentifier ?? "",
            "pid": Int(w.owningApplication?.processID ?? 0),
            "name": w.owningApplication?.applicationName ?? "",
        ],
    ]
}

func writePNG(_ image: CGImage, to path: String) throws {
    let url = URL(fileURLWithPath: path)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "helper", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot create \(path)"])
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else {
        throw NSError(domain: "helper", code: 4, userInfo: [NSLocalizedDescriptionKey: "PNG write failed"])
    }
}

// MARK: - recording

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let queue = DispatchQueue(label: "bru.capture.frames")
    private var started = false
    private(set) var frames = 0
    private var firstPTS: CMTime?
    private var lastPTS: CMTime?
    var onError: ((Error) -> Void)?

    init(outputURL: URL, width: Int, height: Int, fps: Int) throws {
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(4_000_000, width * height * 6),
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ]
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        writer.add(input)
        super.init()
    }

    var sampleQueue: DispatchQueue { queue }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        // Only complete frames carry pixels worth writing.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let statusRaw = attachments.first?[.status] as? Int,
           let status = SCFrameStatus(rawValue: statusRaw), status != .complete {
            return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if !started {
            guard writer.startWriting() else { onError?(writer.error ?? NSError(domain: "helper", code: 5)); return }
            writer.startSession(atSourceTime: pts)
            started = true
            firstPTS = pts
            emit(["event": "started", "at": Date().timeIntervalSince1970])
        }
        guard input.isReadyForMoreMediaData else { return }
        if input.append(sampleBuffer) {
            frames += 1
            lastPTS = pts
            if frames % 30 == 0 { emit(["event": "progress", "frames": frames]) }
        } else if let e = writer.error { onError?(e) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { onError?(error) }

    func finish(_ completion: @escaping (Double) -> Void) {
        queue.async {
            guard self.started else { completion(0); return }
            self.input.markAsFinished()
            let duration = (self.firstPTS != nil && self.lastPTS != nil) ? CMTimeGetSeconds(CMTimeSubtract(self.lastPTS!, self.firstPTS!)) : 0
            self.writer.finishWriting { completion(duration) }
        }
    }
}

// MARK: - commands

Task {
    do {
        switch command {
        case "preflight":
            emit(["ok": true, "granted": CGPreflightScreenCaptureAccess()])
            exit(0)

        case "request":
            // Shows the macOS Screen Recording prompt when not yet granted (returns false until relaunch).
            let granted = CGRequestScreenCaptureAccess()
            emit(["ok": true, "granted": granted, "preflight": CGPreflightScreenCaptureAccess()])
            exit(0)

        case "windows":
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: hasFlag("--onscreen"))
            let bundle = option("--bundle")
            let pid = option("--pid").flatMap { Int32($0) }
            let windows = content.windows.filter { w in
                (bundle == nil || w.owningApplication?.bundleIdentifier == bundle) && (pid == nil || w.owningApplication?.processID == pid)
            }
            emit(["ok": true, "windows": windows.map(windowJSON)])
            exit(0)

        case "still":
            guard let idStr = option("--window"), let id = UInt32(idStr), let out = option("--out") else { fail("usage", usage) }
            let window = try await findWindow(id)
            let scale = scaleFactor(for: window)
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * scale)
            config.height = Int(window.frame.height * scale)
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.captureResolution = .best
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            try writePNG(image, to: out)
            emit(["ok": true, "file": out, "width": image.width, "height": image.height, "scale": scale])
            exit(0)

        case "record":
            guard let idStr = option("--window"), let id = UInt32(idStr), let out = option("--out") else { fail("usage", usage) }
            let fps = Int(option("--fps") ?? "30") ?? 30
            let window = try await findWindow(id)
            let scale = scaleFactor(for: window)
            let width = Int(window.frame.width * scale) / 2 * 2
            let height = Int(window.frame.height * scale) / 2 * 2
            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            config.width = width
            config.height = height
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
            config.queueDepth = 6
            config.pixelFormat = kCVPixelFormatType_32BGRA
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.captureResolution = .best
            try? FileManager.default.removeItem(atPath: out)
            let recorder = try Recorder(outputURL: URL(fileURLWithPath: out), width: width, height: height, fps: fps)
            let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
            try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.sampleQueue)
            var stopping = false
            let stop: () -> Void = {
                if stopping { return }
                stopping = true
                Task {
                    try? await stream.stopCapture()
                    recorder.finish { duration in
                        emit(["ok": true, "file": out, "frames": recorder.frames, "durationMs": Int(duration * 1000), "width": width, "height": height, "scale": scale])
                        exit(0)
                    }
                }
            }
            recorder.onError = { error in emit(["ok": false, "code": "stream_error", "message": error.localizedDescription]); exit(1) }
            let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
            signal(SIGINT, SIG_IGN); sigint.setEventHandler { stop() }; sigint.resume()
            let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
            signal(SIGTERM, SIG_IGN); sigterm.setEventHandler { stop() }; sigterm.resume()
            DispatchQueue.global().async {
                while let line = readLine() { if line.trimmingCharacters(in: .whitespacesAndNewlines) == "stop" { DispatchQueue.main.async { stop() }; break } }
                DispatchQueue.main.async { stop() } // stdin closed → stop too
            }
            try await stream.startCapture()
            emit(["event": "capturing", "width": width, "height": height, "fps": fps])

        default:
            fail("usage", usage)
        }
    } catch {
        let ns = error as NSError
        let code = ns.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain" && (ns.code == -3801 || ns.code == -3802) ? "permission_denied" : "error"
        fail(code, error.localizedDescription)
    }
}
dispatchMain()
