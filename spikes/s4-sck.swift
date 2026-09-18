// S4 spike — can we build against ScreenCaptureKit with CommandLineTools only, and what is the
// Screen Recording permission state? `--list` enumerates windows (prompts if not yet granted).
import Foundation
import CoreGraphics
import ScreenCaptureKit

let granted = CGPreflightScreenCaptureAccess()
print("screen-recording preflight: \(granted ? "granted" : "not granted")")
print("process: \(ProcessInfo.processInfo.processName) pid=\(ProcessInfo.processInfo.processIdentifier) bundle=\(Bundle.main.bundleIdentifier ?? "none")")

if CommandLine.arguments.contains("--list") {
    let sem = DispatchSemaphore(value: 0)
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            print("windows: \(content.windows.count) displays: \(content.displays.count)")
            for w in content.windows where (w.owningApplication?.bundleIdentifier ?? "").contains("usebruno") {
                print("BRUNO window id=\(w.windowID) title=\"\(w.title ?? "")\" frame=\(w.frame) layer=\(w.windowLayer)")
            }
        } catch { print("SCShareableContent error: \(error)") }
        sem.signal()
    }
    sem.wait()
}
