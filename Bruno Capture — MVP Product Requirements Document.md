# Bruno Capture — MVP Product Requirements Document

**Status:** Implementation-ready MVP specification  
**Platform:** macOS  
**Product:** Bruno Capture  
**Primary use case:** Automated generation of documentation screenshots, demo videos, and GIFs of the Bruno desktop application  
**Repository:** Separate from the Bruno application repository

---

# 1. Executive Summary

Bruno Capture is a local visual automation application for creating screenshots, multi-screenshot sequences, videos, and GIFs of the Bruno desktop application.

The application combines:

- natural-language AI planning
- deterministic Playwright/Electron automation
- reusable YAML workflows
- semantic Bruno UI actions
- live capture previews
- native macOS window capture
- FFmpeg media processing
- a local artifact library

The primary interface is a **local browser application**. A secondary CLI supports development, debugging, and scripted use.

A user should be able to enter a request such as:

> Create a GIF showing how to run a collection from the Bruno Runner.

Bruno Capture will:

1. Send a constrained capability description to the configured AI provider.
2. Receive a structured capture plan.
3. Validate that plan locally.
4. Present it for review.
5. Launch or connect to Bruno.
6. Execute a deterministic registered workflow.
7. Show a live preview during execution.
8. Generate the requested artifact.
9. Store the artifact and complete run configuration locally.
10. Present download, copy, regenerate, and deletion actions.

AI is used for **intent interpretation and planning only**. AI never directly controls Bruno.

---

# 2. Problem

Creating polished Bruno screenshots, videos, and GIFs currently requires repetitive manual work:

- navigating Bruno into the desired state
- preparing demo workspaces
- selecting the correct environment
- resizing the application
- applying the correct theme
- running requests or workflows
- waiting for the correct UI state
- capturing screenshots
- recording videos
- trimming recordings
- creating GIFs
- repeating the process after UI changes

The process is time-consuming and difficult to reproduce consistently.

Visual documentation also becomes stale as Bruno changes.

Bruno Capture should turn common visual capture tasks into repeatable, deterministic workflows.

---

# 3. Product Goals

The MVP must:

1. Generate polished screenshots of Bruno.
2. Generate multiple screenshots from a single workflow.
3. Generate silent MP4 videos.
4. Generate GIFs.
5. Support natural-language requests through AI.
6. Allow completely manual workflow execution when AI is unavailable.
7. Automate Bruno deterministically through Playwright/Electron.
8. Support both installed Bruno builds and local development builds.
9. Support reusable, source-controlled workflows.
10. Support custom workflows outside the Bruno Capture repository.
11. Provide live visual feedback during execution.
12. Make generated artifacts immediately downloadable.
13. Preserve sufficient metadata to reproduce and debug captures.
14. Avoid allowing AI to execute arbitrary UI automation.
15. Keep the product primarily local and simple to operate.

---

# 4. Non-Goals for MVP

The MVP will not include:

- Windows support
- Linux support
- audio recording
- microphone recording
- system-audio recording
- 60 FPS video
- cloud-hosted artifact storage
- artifact sharing links
- automatic publishing to documentation systems
- direct publishing to social networks
- visual regression as a user-facing feature
- automated documentation refresh pipelines
- CI as a formally supported production workflow
- multiple concurrent capture runs
- run queues
- workflow branching
- workflow loops
- arbitrary workflow scripts
- arbitrary AI-generated Playwright
- autonomous computer-use fallback
- AI-generated workflows
- a visual workflow builder
- a built-in YAML editor
- automatic screenshot annotations
- captions
- video title cards
- automated zoom effects
- automated video editing
- isolated Bruno profiles
- restoring the user's prior Bruno state after capture
- native packaged Bruno Capture desktop application
- automatic deletion of generated capture artifacts

---

# 5. Primary Users

## 5.1 Developer Relations

Create:

- product demo GIFs
- feature videos
- social assets
- release assets

## 5.2 Documentation Authors

Create:

- consistent UI screenshots
- sequential workflow screenshots
- wide screenshots
- feature-specific cropped screenshots

## 5.3 Product and Engineering

Create:

- reproducible feature demos
- internal examples
- release previews
- debugging captures

---

# 6. Core User Experience

The primary experience is a local browser application with four sections:

- **Capture**
- **Workflows**
- **Library**
- **Settings**

The browser communicates only with a locally running Bruno Capture backend.

Starting Bruno Capture:

```text
bru-capture
```

should:

1. Start the local backend.
2. Select an available localhost port.
3. Run system checks.
4. Open the Bruno Capture interface in the user's default browser.

The application must remain usable even when optional dependencies are unavailable.

---

# 7. Capture Screen

The Capture screen is the primary entry point.

It contains:

## 7.1 Natural-Language Prompt

Example:

```text
What do you want to create?

[ Show the OpenAPI Sync workflow detecting a changed spec ]
```

## 7.2 Output Selector

Options:

- Auto
- Screenshot
- Screenshots
- Video
- GIF

`Auto` allows the AI planner to select an appropriate output type.

## 7.3 Manual Workflow Selection

Users must be able to bypass AI entirely and select:

- a capture
- a workflow
- an output format
- a preset
- parameters

## 7.4 Capture Plan

After AI planning, show a structured plan containing:

- feature
- selected capture/workflow
- output
- preset
- parameters
- framing
- confidence
- AI provider/model used

Actions:

- Generate
- Edit
- Change Workflow

Editing these values should not require another AI request when a structured local control can make the change.

---

# 8. AI Architecture

AI is required in the MVP but is not part of workflow execution.

Its role ends after generation and validation of a `CapturePlan`.

AI MUST NOT:

- directly control Bruno
- receive access to Playwright
- generate executable Playwright
- generate shell commands
- choose arbitrary CSS/XPath selectors
- interact with the filesystem
- execute workflows
- interact with the user's desktop
- receive arbitrary local files
- receive Bruno source code by default
- receive screenshots by default

---

# 9. AI Providers

MVP supports:

- OpenAI
- Anthropic

Both providers use a common provider abstraction.

Conceptual interface:

```ts
interface AIProvider {
  id: 'openai' | 'anthropic';

  planCapture(
    request: CapturePlanningRequest
  ): Promise<CapturePlan>;

  testConnection(): Promise<ProviderStatus>;
}
```

---

# 10. Provider Configuration

Settings contains:

- preferred provider
- OpenAI API key status
- OpenAI model
- Anthropic API key status
- Anthropic model
- Test Connection actions

One model is configured per provider.

There is no per-request model selector in MVP.

---

# 11. Provider Fallback

The user selects one global preferred provider.

Example:

```text
Preferred Provider: OpenAI

OpenAI
Model: [ configured model ]
Status: Connected

Anthropic
Model: [ configured model ]
Status: Connected
Fallback: Enabled
```

Execution behavior:

1. Send request to preferred provider.
2. If the provider fails due to network, timeout, quota, or provider error, attempt the fallback provider.
3. If structured output is malformed, perform one repair attempt using the same provider.
4. If the repaired result is still invalid, the other configured provider may be attempted.
5. Do not repeatedly bounce between providers.

The UI must show when fallback occurred.

---

# 12. API Key Storage

API keys are stored in **macOS Keychain**.

They must not be stored in:

- browser localStorage
- frontend JavaScript configuration
- workflow YAML
- artifact manifests
- log files

Environment variables may override Keychain values for development.

Example:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

Provider requests are always made by the local backend.

---

# 13. AI Request Context

The model receives only information required to produce a capture plan.

Typical context:

- user's natural-language request
- available feature IDs
- capture IDs
- workflow IDs
- workflow descriptions
- workflow parameter schemas
- supported output formats
- available presets
- valid enum values
- required structured-output schema

Do not send by default:

- Bruno source code
- Bruno repository contents
- workflow source code
- Playwright implementation
- screenshots
- arbitrary files
- credentials
- API keys
- local filesystem contents

---

# 14. Capture Plan Schema

Conceptual model:

```ts
type CapturePlan =
  | {
      type: 'capture';
      feature: string;
      capture: string;
      output: 'screenshot';
      parameters: Record<string, unknown>;
      preset: string;
      confidence: number;
    }
  | {
      type: 'workflow';
      workflow: string;
      output: 'screenshots' | 'video' | 'gif';
      parameters: Record<string, unknown>;
      preset: string;
      confidence: number;
    };
```

The actual implementation must use Zod.

---

# 15. AI Plan Validation

Validation order:

1. Parse structured response.
2. Validate Zod schema.
3. Validate feature ID.
4. Validate capture/workflow ID.
5. Validate output support.
6. Validate declared parameters.
7. Validate parameter values.
8. Validate preset.
9. Evaluate confidence.

No plan may execute until local validation succeeds.

---

# 16. Confidence Behavior

Suggested thresholds:

### >= 0.80

Plan is presented normally and may be generated immediately.

### 0.50–0.79

Show:

```text
Review recommended
```

Require normal plan review before execution.

### < 0.50

Do not present the result as ready to run.

Instead show likely matching workflows or captures for manual selection.

---

# 17. Manual Operation

AI availability must never block deterministic capture features.

If both AI providers are unavailable:

- Capture remains usable.
- Workflows remain usable.
- Library remains usable.
- Existing captures remain downloadable.
- Manual workflow configuration remains available.

---

# 18. Technical Architecture

Recommended repository structure:

```text
bruno-capture/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── shared/
│   ├── core/
│   ├── automation/
│   ├── workflows/
│   ├── ai/
│   └── media/
├── workflows/
├── fixtures/
├── native/
│   └── macos-capture-helper/
├── scripts/
├── package.json
└── pnpm-workspace.yaml
```

---

# 19. Technology Stack

## Frontend

- React
- TypeScript
- Vite

## Backend

- Node.js
- TypeScript
- Fastify

## Validation

- Zod

## Realtime updates

- Server-Sent Events

## Package manager

- pnpm

## Bruno automation

- Playwright
- Playwright Electron
- Chromium DevTools Protocol when attaching to an already-running compatible Bruno instance

## Renderer recording

Use Playwright page screencasting for App Content Only video recording. Current Playwright exposes a page screencast API that can save WebM video and/or emit frames.

## Native full-window recording

Use a small macOS native helper built on ScreenCaptureKit.

ScreenCaptureKit supports filtering a stream to a specific macOS window, allowing Bruno Capture to record Bruno without recording unrelated windows or the complete desktop.

## Media processing

- system FFmpeg
- MP4/H.264 normalization
- GIF conversion
- cropping
- resizing
- frame-rate normalization
- ZIP generation handled in Node

---

# 20. Local Security Model

The backend must:

- bind to `127.0.0.1`
- reject non-localhost origins
- not expose API keys to the frontend
- avoid permissive CORS
- validate all request payloads
- validate file paths before use
- prevent path traversal
- avoid executing workflow-provided shell commands
- avoid evaluating arbitrary workflow JavaScript

Bruno Capture is a local application, but its local HTTP interface should still be treated as privileged.

---

# 21. Bruno Application Selection

Bruno Capture supports:

1. installed Bruno
2. local Bruno development build

Installed Bruno is the default.

At startup, Bruno Capture should inspect common macOS application locations.

Users may always override detection manually.

Settings displays:

```text
Bruno Application

Detected:
Bruno.app

Path:
[/Applications/Bruno.app]

[Choose…]
```

Manual selection may point to either:

- a packaged Bruno application
- a local development executable

---

# 22. Existing Bruno Process Behavior

If Bruno is already running:

### Case 1 — compatible automation connection available

Reuse the existing Bruno instance.

CDP may be used when the running Electron application exposes a debugging endpoint. Playwright supports CDP connections to Chromium/Electron applications, although Playwright documents CDP as lower fidelity than its native Playwright connection.

### Case 2 — Bruno is running without automation access

Prompt:

```text
Bruno needs to be relaunched to enable capture automation.

[Relaunch Bruno & Continue]
[Cancel]
```

Bruno Capture then relaunches the same selected Bruno application using the user's existing Bruno profile.

When Bruno is not already running, Bruno Capture should launch it under Playwright automation control.

Playwright's Electron API supports launching and controlling Electron applications and their windows.

---

# 23. Bruno User Profile

MVP uses the user's normal Bruno profile and settings.

The MVP does **not** create a fresh isolated Bruno user profile.

Consequences:

- existing Bruno preferences may influence the application
- captures may change the user's current Bruno state
- workflows must explicitly set important visual state such as theme when deterministic output is required

Post-MVP should introduce isolated profile support.

---

# 24. State Restoration

Bruno Capture will not restore the user's previous Bruno state after a run.

After execution Bruno remains in the workflow's final state.

This includes:

- active workspace
- open request
- active tab
- theme
- selected environment
- resized window
- other UI state changed by the workflow

---

# 25. Bruno Version Compatibility

MVP uses a **best-effort compatibility model**.

There is no formal supported-version matrix.

Bruno Capture:

- runs against the selected Bruno build
- records the selected Bruno version when available
- fails clearly when UI changes break an action
- stores debugging information

The application must not block execution solely because a Bruno version is unknown or outside a predefined range.

---

# 26. Workflow System

Capture behavior is represented as deterministic YAML.

There are two concepts:

## Capture Definition

Represents a specific single visual state, usually producing one screenshot.

## Workflow Definition

Represents a sequence of deterministic steps capable of producing:

- screenshots
- video
- GIF

---

# 27. Workflow Discovery

Workflows come from three sources:

### Built-in

Stored in the Bruno Capture repository.

### Custom Directory

One or more user-configured workflow directories.

### Imported

An individual YAML file referenced from anywhere on disk.

The Workflows UI visibly labels each source:

```text
Built-in
Custom Directory
Imported
```

---

# 28. Imported Workflow Files

Imported workflows remain **in place**.

Bruno Capture stores their absolute path.

It does not copy the workflow into its configuration directory.

External edits therefore remain authoritative.

Missing files must show:

```text
Workflow file not found
```

Invalid files must show validation errors rather than disappearing silently.

---

# 29. Workflow Reloading

Bruno Capture supports both:

- automatic filesystem watching
- manual **Refresh Workflows**

When a file changes:

1. reload it
2. validate it
3. update the UI
4. report validation errors without crashing

An active run uses the workflow snapshot loaded when the run started.

A file change never modifies an active run.

---

# 30. Workflow Editing

The Workflows UI is **view-only** in MVP.

Users can inspect:

- name
- ID
- description
- feature
- source
- source path
- supported outputs
- parameters
- steps
- capture points
- recording configuration

Editing occurs in an external text editor.

---

# 31. Workflow Parameters

Workflows declare configurable parameters.

Example:

```yaml
parameters:
  environment:
    type: select
    label: Environment
    options:
      - Development
      - Staging
    default: Development

  baseUrl:
    type: string
    label: Base URL
    default: https://example.com
```

Bruno Capture automatically renders a parameter form.

The same parameter schema is exposed to the AI planner.

AI may populate only parameters explicitly declared by a workflow.

The user may override AI-generated values before execution.

---

# 32. Supported Parameter Types

MVP should support at least:

```text
string
number
boolean
select
file
directory
```

Optional validation:

- required
- default
- enum/options
- min/max
- string pattern where necessary

---

# 33. Workflow Schema

Conceptual structure:

```yaml
version: 1

id: runner-collection-run
name: Run a Collection
description: Runs a collection through the Bruno Runner.

feature: runner

supportedOutputs:
  - screenshots
  - video
  - gif

parameters:
  environment:
    type: string
    required: false

fixture:
  source: bundled
  path: runner/basic-workspace

defaults:
  preset: demo-video

steps:
  - action: workspace.open

  - action: runner.open

  - capture:
      id: runner-open

  - startRecording: {}

  - action: runner.runCollection

  - waitFor:
      condition: runner.complete

  - pause: 800

  - capture:
      id: runner-complete

  - stopRecording: {}
```

The actual schema must be defined in Zod.

---

# 34. Linear Workflow Model

MVP workflows are linear.

The following are not supported:

```text
loops
branches
conditions
arbitrary JavaScript
shell execution
dynamic code evaluation
```

Workflow complexity should instead be captured through semantic actions and parameters.

---

# 35. Workflow Step Types

MVP supports:

```text
action
capture
waitFor
pause
startRecording
stopRecording
```

A limited selector/action escape hatch is also allowed.

---

# 36. Semantic Actions

Workflows should primarily use reusable semantic Bruno actions.

Examples:

```text
workspace.open
request.open
request.send
runner.open
runner.runCollection
environment.select
timeline.open
openapi.import
openapi.sync
mockServer.start
mockServer.stop
theme.set
```

Conceptual contract:

```ts
interface CaptureAction<TParams = unknown> {
  id: string;
  retryable: boolean;

  execute(
    context: WorkflowContext,
    parameters: TParams
  ): Promise<void>;
}
```

---

# 37. Workflow Context

Conceptually:

```ts
interface WorkflowContext {
  runId: string;

  bruno: {
    mode: 'electron' | 'cdp';
    page: Page;
    app?: ElectronApplication;
    executablePath: string;
    version?: string;
  };

  workspacePath?: string;

  parameters: Record<string, unknown>;

  artifactPaths: RunArtifactPaths;

  capture: CaptureController;

  recording: RecordingController;
}
```

---

# 38. Selector Escape Hatch

A workflow may use a raw locator when a semantic action does not yet exist.

It must not contain executable code.

Example:

```yaml
- selectorAction:
    operation: click
    locator: '[data-testid="runner-button"]'
```

Allowed operations should be an explicit allowlist such as:

- click
- fill
- press
- hover
- selectOption

These steps should be marked as technical debt and migrated to semantic actions where practical.

---

# 39. Action Synchronization

Semantic actions own their readiness behavior.

Example:

`runner.open` does not simply click the Runner button.

It:

1. identifies the Runner trigger
2. clicks it
3. waits until the Runner UI is in its expected open state
4. returns

Workflow authors should not need arbitrary sleeps for synchronization.

---

# 40. Explicit Waits

Workflows may use `waitFor` for special cases.

Examples:

```yaml
- waitFor:
    visible:
      region: runner.results
```

```yaml
- waitFor:
    hidden:
      locator: '[data-testid="loading-spinner"]'
```

```yaml
- waitFor:
    text:
      locator: '[data-testid="status"]'
      equals: Complete
```

Supported conditions should include:

- visible
- hidden
- attached
- detached
- text present
- text equals
- semantic state

`waitFor` is synchronization.

`pause` is presentation timing.

They are not interchangeable.

---

# 41. Pauses

Semantic actions may contain short default settle times where visually necessary.

Workflow authors may also add explicit presentation pauses:

```yaml
- pause: 800
```

Pauses are useful for:

- giving viewers time to see a panel
- allowing cursor motion to finish
- giving GIFs more readable pacing
- holding a final state before recording ends

Fixed delays should not be the primary synchronization mechanism.

---

# 42. Retry Behavior

Safe and idempotent UI actions retry once by default when they fail for a transient reason.

Examples:

- opening a panel
- selecting a tab
- expanding a section

Potentially side-effecting actions do not automatically retry.

Examples:

- sending a request
- executing a collection
- starting a server
- modifying a source document

Retry safety is declared by the semantic action implementation.

If retry fails, normal workflow failure behavior applies.

---

# 43. Step Failure Behavior

Default:

```text
stop workflow on first failed step
```

Individual steps may declare:

```yaml
continueOnError: true
```

When used:

- error is recorded
- workflow continues
- final run is marked `completed_with_errors`

---

# 44. Fixtures

Two fixture models are supported.

## Bundled Fixtures

Stored within the Bruno Capture repository.

They are designed for deterministic built-in workflows.

Before execution, bundled fixtures are copied into a temporary run workspace.

The source fixture is never modified.

## User-Supplied Fixtures

A workflow may reference arbitrary user files or directories.

By default these are used in place.

A workflow parameter may request an isolated copy:

```yaml
fixture:
  source: parameter
  parameter: workspace
  copy: true
```

---

# 45. Temporary Workspace Cleanup

Temporary per-run workspaces behave as follows:

### Successful run

Delete the temporary workspace after final artifacts and the manifest have been committed.

### Failed run

Preserve the relevant temporary workspace under the run's debug data.

### Cancelled run

Preserve the relevant temporary workspace under the run's debug data.

This balances storage usage with debuggability.

---

# 46. Network and Mocking

Bruno Capture must **not** introduce its own generic Node mock-server architecture.

When a workflow needs mocked HTTP behavior, it should use Bruno's built-in mock server.

Workflows may use:

- Bruno built-in mock server
- real external APIs

The workflow explicitly determines which approach it uses.

External API usage must not be silently replaced with mocks.

---

# 47. Capture Targets

All supported output types may target:

1. App Content Only
2. Full App Window
3. Named semantic region
4. Stable Playwright locator

Examples of named regions:

```text
runner.panel
response.body
timeline.panel
environment.selector
request.editor
```

---

# 48. Screenshot Capture

Default screenshot framing:

```text
App Content Only
```

Supported screenshot modes:

- app content
- full application window
- semantic region
- locator

Renderer screenshots should use Playwright `page.screenshot()` or locator screenshot behavior as appropriate.

Full application window screenshots use the macOS native capture adapter.

---

# 49. Video Capture Architecture

Video uses a hybrid model.

## App Content Only

Use Playwright renderer screencasting.

Intermediate output:

```text
WebM
```

## Full App Window

Use the macOS native ScreenCaptureKit helper targeting Bruno's specific window.

This prevents unrelated desktop content from being included.

Apple's ScreenCaptureKit supports a content filter that captures a single window independently.

## Final Output

All video is normalized with FFmpeg to:

```text
MP4
H.264
30 FPS
No audio
```

---

# 50. Recording Boundaries

Default behavior:

```text
record the entire workflow
```

A workflow can override this with:

```yaml
- startRecording: {}
```

and:

```yaml
- stopRecording: {}
```

When explicit recording steps exist, only the bounded section is included.

The same behavior applies to:

- video
- GIF

Screenshots can still be captured before, during, or after the recording region.

---

# 51. GIF Generation

GIFs use the same deterministic workflow and recording mechanism as video.

Pipeline:

```text
workflow
  ↓
temporary recording
  ↓
crop/resize if required
  ↓
FFmpeg palette generation
  ↓
GIF
```

GIF generation must use proper palette generation rather than naive frame conversion.

---

# 52. Frame Rate

MVP output frame rate:

```text
30 FPS
```

60 FPS is post-MVP.

Intermediate recordings may use different timing internally, but FFmpeg normalizes final video output to 30 FPS.

---

# 53. Audio

MVP recordings are silent.

Do not request:

- microphone permission
- system-audio permission

Do not include an audio track unless required by the final encoding implementation, and if included technically it must contain no captured user audio.

---

# 54. Capture Presets

Built-in presets:

## Docs Screenshot

```text
Dimensions: 1600 × 1000
Theme: Light
Framing: App Content Only
Cursor: Hidden
Output: PNG
```

## Docs Wide

```text
Dimensions: 1920 × 1080
Theme: Light
Framing: App Content Only
Cursor: Hidden
Output: PNG
```

## Demo Video

```text
Dimensions: 1920 × 1080
Theme: Dark
Framing: App Content Only
Cursor: Smooth
Frame rate: 30 FPS
Output: MP4/H.264
```

## Docs GIF

```text
Width: 1000 px
Height: Derived from capture aspect ratio
Theme: Light
Framing: App Content Only
Cursor: Hidden
Output: GIF
```

Users may override these values under Advanced Settings.

---

# 55. Theme Handling

Theme is preset-driven.

Defaults:

```text
Documentation presets → Light
Demo/video presets → Dark
```

Workflows may explicitly override theme where required.

Theme should be set deterministically through a semantic action before captures occur.

---

# 56. Dimensions

Built-in dimension presets:

```text
Docs Screenshot   1600 × 1000
Docs Wide         1920 × 1080
Demo Video        1920 × 1080
Docs GIF          1000 px wide
```

Advanced Settings permit custom dimensions.

Bruno Capture should configure the Bruno viewport/window whenever possible before the workflow begins.

If an attached existing Bruno instance cannot satisfy deterministic geometry, Bruno Capture may require a controlled relaunch before the run proceeds.

---

# 57. Region Recording

Video and GIF may target a region.

At recording start:

1. resolve the semantic region or locator
2. obtain its bounding rectangle
3. translate coordinates into the active capture surface
4. record the source
5. crop during capture or FFmpeg post-processing

MVP treats the recording crop region as fixed for the recording segment.

Workflows should avoid region-targeted recordings where the target itself moves substantially.

---

# 58. Synthetic Cursor

Bruno Capture uses a synthetic cursor overlay.

It does not rely on the native macOS cursor.

Cursor modes:

```text
hidden
visible
smooth
```

## Visible

Cursor jumps to interaction coordinates before the action.

## Smooth

Bruno Capture animates the synthetic cursor between interaction targets using deterministic interpolated motion.

Exact easing and animation duration are implementation details.

A reasonable default is approximately 200–350 ms per movement, adjusted for distance.

The native cursor should be excluded from recorded output where possible.

---

# 59. Live Preview

Capture execution displays a live preview in the browser.

This is not true video streaming.

Bruno Capture sends periodic screenshots at approximately:

```text
500–1000 ms intervals
up to ~2 FPS
```

Preview frames:

- are temporary
- are not final artifacts
- are not stored permanently
- should represent the current Bruno visual state

The UI also displays the active workflow step.

Example:

```text
Running 5 of 8

Running collection…

[ Live Bruno Preview ]

[Cancel Run]
```

On completion, the live preview is replaced by the final artifact preview.

---

# 60. Screen Recording Permission

System Status proactively checks whether native capture can be used.

If permission is missing:

```text
Screen Recording
Action Required

[Open System Settings]
```

Bruno Capture checks again immediately before a native Full App Window capture.

Native capture should fail before the workflow enters the recording section rather than producing an empty/black recording.

Apple notes that ScreenCaptureKit capture requires the relevant system permission.

---

# 61. Native macOS Helper

A minimal native helper should support:

- enumerating capturable windows
- identifying the Bruno window
- ScreenCaptureKit video capture
- full-window still capture
- screen-recording permission checks
- optionally native file/directory selection for the browser UI

The helper should contain no workflow logic.

Workflow orchestration remains in Node.

---

# 62. FFmpeg

FFmpeg is a required **system dependency**.

It is not bundled in MVP.

At startup:

```text
ffmpeg -version
```

should be used to detect availability.

System Status must show whether FFmpeg is installed.

If unavailable:

### Still allowed

- screenshots
- browsing workflows
- AI planning
- capture library
- manual configuration

### Disabled

- final MP4 processing
- GIF generation
- media cropping requiring FFmpeg
- media format normalization

The UI should provide macOS installation guidance.

FFmpeg's AVFoundation device support is available on macOS, although Bruno Capture's primary Full App Window design uses ScreenCaptureKit rather than generic display recording.

---

# 63. Run Concurrency

Only **one capture run** may execute at a time.

No queue exists in MVP.

If another capture is requested while one is active:

```text
A capture is already running.

Cancel the current capture and start this one?

[Cancel Current & Start New]
[Keep Current Run]
```

---

# 64. Cancellation

The run screen contains:

```text
[Cancel Run]
```

Cancellation should gracefully:

1. stop workflow execution
2. stop active recording
3. stop FFmpeg/media processing
4. terminate run-owned helper processes
5. close Bruno only if doing so is necessary and Bruno Capture exclusively owns that launched process
6. preserve completed artifacts
7. preserve useful debug data
8. mark run `cancelled`

Do not delete successfully generated files from earlier workflow steps.

---

# 65. Run State Machine

Recommended states:

```text
created
  ↓
validating
  ↓
preparing
  ↓
connecting
  ↓
running
  ↓
processing
  ↓
completed
```

Terminal variants:

```text
completed_with_errors
failed
cancelled
```

Only one terminal state may be assigned.

---

# 66. Run Events

The backend emits events through SSE.

Suggested event types:

```text
run.status
workflow.started
workflow.step.started
workflow.step.completed
workflow.step.failed
preview.frame
artifact.created
recording.started
recording.stopped
processing.started
processing.completed
run.completed
run.failed
run.cancelled
```

---

# 67. Artifact Storage

Every execution creates one immutable run directory.

Recommended root:

```text
~/Library/Application Support/Bruno Capture/artifacts/
```

Example:

```text
run_01K5XYZ/
├── manifest.json
├── workflow.yaml
├── screenshots/
│   ├── runner-open.png
│   └── runner-complete.png
├── video/
│   └── runner-collection-run.mp4
├── gif/
│   └── runner-collection-run.gif
└── debug/
    ├── run.log
    ├── errors.json
    └── workspace/
```

Not every subdirectory needs to contain files.

---

# 68. Immutable Runs

Once a run completes, its files are not overwritten.

Regeneration creates a **new run**.

This ensures historical captures remain reproducible.

The only operation that removes a run is explicit deletion by the user.

---

# 69. Manifest

Every run stores:

```json
{
  "runId": "run_01K5XYZ",
  "status": "completed",
  "createdAt": "...",
  "completedAt": "...",

  "request": {
    "prompt": "...",
    "plan": {}
  },

  "workflow": {
    "id": "runner-collection-run",
    "source": "...",
    "sourcePath": "...",
    "snapshot": "workflow.yaml"
  },

  "parameters": {},

  "capture": {
    "output": "video",
    "preset": "demo-video",
    "theme": "dark",
    "framing": "app-content",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "cursor": "smooth"
  },

  "bruno": {
    "executablePath": "...",
    "version": "..."
  },

  "ai": {
    "provider": "openai",
    "model": "...",
    "fallbackOccurred": false
  },

  "artifacts": [],

  "steps": [],

  "errors": []
}
```

Never store provider API keys.

---

# 70. Workflow Snapshot

Every run copies the exact validated workflow definition into:

```text
workflow.yaml
```

The manifest also contains resolved parameters.

This means a historical run remains understandable even after:

- the source workflow changes
- parameters are renamed
- defaults change
- the workflow file is removed

---

# 71. Regeneration

A completed capture offers two actions.

## Regenerate Exact

Uses:

- saved workflow snapshot
- saved parameters
- saved preset
- saved capture configuration

It creates a new run.

## Regenerate Latest

Loads the current workflow definition.

It then attempts to reapply the original parameter values.

If:

- a parameter was removed
- its type changed
- its previous value is invalid
- a new required parameter exists

show the configuration form and require review before execution.

---

# 72. Artifact Retention

Artifacts persist until manually deleted.

There is no:

- automatic expiration
- age-based cleanup
- quota cleanup
- storage-pressure cleanup

MVP includes:

```text
Delete Capture
```

Deletion removes the run directory after user confirmation.

---

# 73. Downloads

Every artifact has a prominent download action.

Examples:

```text
Download PNG
Download GIF
Download MP4
```

Screenshots additionally support:

```text
Copy
```

using browser clipboard APIs where supported.

---

# 74. Multi-Artifact Downloads

A run with multiple outputs provides:

```text
Download All
```

This generates a ZIP on demand.

Multi-screenshot workflows additionally allow:

```text
Select screenshots
Download Selected
```

which produces a ZIP containing only the selected assets.

---

# 75. Human-Readable Filenames

Use descriptive filenames such as:

```text
openapi-sync-changes-detected.png
runner-collection-run.gif
request-response-success.mp4
```

Do not expose UUID-only filenames as the primary user-facing artifact name.

---

# 76. Library

Library defaults to:

```text
Newest First
```

Filters:

- feature
- workflow
- output type

Output filters:

```text
All
Screenshots
Videos
GIFs
```

---

# 77. Library Item

Each card should show:

- thumbnail/preview
- output type
- workflow
- feature
- creation time
- status

Primary actions:

- Open
- Download
- Regenerate
- Delete

---

# 78. Artifact Detail Screen

Display:

- preview
- generated date
- workflow
- feature
- output type
- preset
- dimensions
- frame rate where relevant
- duration where relevant
- file size
- Bruno version
- Bruno executable
- provider/model where AI was used
- resolved parameters
- source path

Actions:

- Download
- Copy when applicable
- Open File
- Reveal in Finder
- Regenerate Exact
- Regenerate Latest
- Delete

---

# 79. Result Preview

Use native browser preview controls:

### PNG

```html
<img>
```

### GIF

```html
<img>
```

### MP4

```html
<video controls>
```

The user should not need to leave Bruno Capture to inspect the output.

---

# 80. Workflows Screen

Show searchable workflow cards.

Each card includes:

- name
- feature
- source type
- supported outputs

Detail screen includes:

- description
- YAML path
- parameters
- fixture
- steps
- capture points
- recording boundaries
- supported outputs
- validation status

Actions:

- Run
- Reveal Source
- Refresh

Imported/custom workflows may also expose:

```text
Remove Reference
```

which removes them from Bruno Capture without deleting the source YAML.

---

# 81. Path Selection

Because the primary UI is browser-based while workflow references must remain in place, path selection is handled through the local backend/native helper.

Uses include:

- selecting Bruno.app
- importing a workflow YAML path
- adding a custom workflow directory
- choosing fixture files
- choosing fixture directories

Manual path entry should also be available as a fallback.

---

# 82. Settings

Settings sections:

## Bruno

- detected application
- executable path
- Choose…
- detected version

## Capture

- default preset
- artifact root
- preview enabled
- advanced defaults

## AI

- preferred provider
- OpenAI model
- OpenAI key status
- Test OpenAI
- Anthropic model
- Anthropic key status
- Test Anthropic

## Workflows

- custom directories
- imported files
- filesystem watching
- Refresh Workflows

## System

- FFmpeg status
- Screen Recording status
- artifact directory status

---

# 83. System Status

Show status for:

```text
Bruno
FFmpeg
Screen Recording
Artifact Directory
OpenAI
Anthropic
Workflow Registry
```

Possible states:

```text
Ready
Not Configured
Action Required
Unavailable
Error
```

Missing dependencies should disable only affected operations.

The overall app should still launch.

---

# 84. Backend API

Suggested local API:

## System

```text
GET  /api/system/status
POST /api/system/select-path
```

## Settings

```text
GET  /api/settings
PUT  /api/settings
```

Secrets should use separate backend handling rather than being returned in plaintext.

## AI

```text
POST /api/plan
POST /api/ai/openai/test
POST /api/ai/anthropic/test
```

## Capabilities

```text
GET /api/capabilities
```

## Workflows

```text
GET    /api/workflows
GET    /api/workflows/:id
POST   /api/workflows/refresh
POST   /api/workflows/import
DELETE /api/workflows/import/:id
```

## Runs

```text
POST /api/runs
GET  /api/runs/:id
GET  /api/runs/:id/events
POST /api/runs/:id/cancel
POST /api/runs/:id/regenerate
DELETE /api/runs/:id
```

## Library

```text
GET /api/library
```

## Artifacts

```text
GET  /api/artifacts/:id
GET  /api/artifacts/:id/download
POST /api/runs/:id/archive
```

---

# 85. Run Creation Contract

Conceptually:

```json
{
  "workflowId": "runner-collection-run",
  "output": "video",
  "preset": "demo-video",
  "parameters": {
    "environment": "Development"
  },
  "overrides": {
    "theme": "dark",
    "width": 1920,
    "height": 1080,
    "cursor": "smooth"
  }
}
```

Backend validation is authoritative.

Never trust frontend validation alone.

---

# 86. Screenshot Processing

Screenshot outputs should be PNG by default.

Processing stages may include:

1. capture
2. crop
3. resize
4. synthetic-cursor composition if necessary
5. write final PNG
6. register artifact
7. emit artifact event

Avoid recompressing PNG repeatedly.

---

# 87. Video Processing

Recommended pipeline:

```text
Playwright WebM
or
ScreenCaptureKit recording
        ↓
target crop
        ↓
resize/pad
        ↓
30 FPS normalization
        ↓
H.264
        ↓
MP4
```

The original intermediate recording does not need to be retained after a successful run unless debug mode explicitly requests it.

On failure it should be preserved under `debug/` when useful.

---

# 88. GIF Processing

Recommended FFmpeg pipeline:

```text
input recording
      ↓
crop
      ↓
scale
      ↓
fps conversion
      ↓
palettegen
      ↓
paletteuse
      ↓
final GIF
```

GIF output should prioritize readability and reasonable file size rather than matching the 30 FPS MP4 output exactly.

---

# 89. Initial MVP Feature Coverage

MVP must provide capture coverage for at least:

## Runner

- runner open
- collection ready
- collection executing
- results
- success state

Outputs:

- screenshots
- video
- GIF

## Request Execution

- request selected
- request configured
- request sent
- response displayed

Outputs:

- screenshots
- video
- GIF

## OpenAPI Sync

- imported API
- sync available
- changes detected
- updated state

Outputs:

- screenshots
- video
- GIF

## Environments

- environment selector
- selected environment
- environment variables

Outputs:

- screenshots
- video

## Timeline

- timeline open
- scripted/request activity visible

Outputs:

- screenshots
- video

---

# 90. Minimum Capture Content

MVP should ship with at least:

```text
5 feature areas
15 screenshot states
3 multi-step screenshot workflows
3 video workflows
3 GIF workflows
```

The three most important end-to-end workflows should be:

1. Runner collection execution
2. Request execution and response
3. OpenAPI Sync workflow

---

# 91. Built-In Fixtures

Built-in workflows should favor bundled deterministic examples.

Suggested fixture groups:

```text
fixtures/
├── runner/
├── request-execution/
├── openapi-sync/
├── environments/
└── timeline/
```

Where HTTP behavior is needed, prefer Bruno's native mock-server capability.

---

# 92. CLI

The browser UI is primary, but the CLI remains useful.

Suggested commands:

```text
bru-capture
```

Start server and open browser.

```text
bru-capture doctor
```

Show system/dependency state.

```text
bru-capture workflows list
```

```text
bru-capture workflows validate
```

```text
bru-capture workflow add /path/workflow.yaml
```

```text
bru-capture run runner-collection-run \
  --output video
```

The CLI should call the same underlying services as the browser backend rather than implementing a second workflow engine.

---

# 93. Logging and Debugging

Each run should produce structured logs.

Logs should include:

- run state transitions
- workflow ID
- step number
- action ID
- timing
- retries
- waits
- recording events
- FFmpeg invocation result
- errors

Logs must not include:

- API keys
- authorization headers
- secrets from Keychain

Failed/cancelled runs should preserve additional debug material where practical.

---

# 94. Error UX

Errors should answer three questions:

1. What failed?
2. At which workflow step?
3. What can the user do next?

Bad:

```text
Timeout
```

Good:

```text
Runner did not become visible.

Workflow:
Run a Collection

Step:
3 — runner.open

Bruno version:
3.x.x

[View Debug Details]
[Retry Capture]
```

---

# 95. Missing Dependency UX

Example:

```text
GIF generation is unavailable because FFmpeg was not found.

Screenshots can still be generated.

[Setup Instructions]
[Recheck]
```

The entire application should not fail because one capability is unavailable.

---

# 96. Workflow Validation Errors

Example:

```text
runner-demo.yaml

Invalid workflow

steps[3].pause:
Expected a positive number.

[Reveal File]
```

A bad external workflow must never prevent built-in workflows from loading.

---

# 97. File Watching

Workflow file watching should:

- debounce rapid changes
- revalidate only affected files where practical
- retain the last-known source path
- update UI validation state
- never alter an already-active run

A manual Refresh button remains available even when watching is enabled.

---

# 98. Data Persistence

The MVP does not require a database.

Recommended local persistence:

```text
~/Library/Application Support/Bruno Capture/
├── settings.json
├── workflow-sources.json
└── artifacts/
```

Artifact metadata is authoritative through each run's `manifest.json`.

The Library can index manifests at startup and cache results in memory.

API secrets remain in macOS Keychain.

---

# 99. Testing Strategy

## Unit Tests

Test:

- Zod schemas
- parameter resolution
- workflow loading
- capture plans
- provider fallback
- filename generation
- manifest generation
- crop calculations
- retry classification

## Workflow Validation Tests

Every built-in workflow must validate in CI.

## Semantic Action Tests

Each important action should test:

- precondition
- action
- expected postcondition
- failure reporting

## AI Contract Tests

Use mocked provider responses for:

- valid plan
- invalid schema
- unsupported workflow
- invalid parameter
- malformed JSON
- repair
- provider fallback

Do not require real AI API calls for normal automated tests.

## Integration Tests

On macOS:

- launch supported Bruno test build
- execute representative workflows
- verify outputs exist
- verify dimensions
- verify manifest
- verify cancellation

## Media Tests

Verify generated:

- PNG
- H.264 MP4
- GIF

with metadata inspection rather than subjective visual comparison alone.

---

# 100. MVP Acceptance Criteria

The MVP is complete when all of the following are true.

## Application

- `bru-capture` launches the local UI.
- Capture, Workflows, Library, and Settings are functional.
- Missing optional dependencies do not prevent launch.

## Bruno Control

- Bruno can be auto-detected.
- Bruno path can be overridden.
- Installed Bruno can be automated.
- Local development Bruno can be automated.
- Existing compatible Bruno can be reused.
- Non-compatible running Bruno can be relaunched under automation control.

## AI

- OpenAI supported.
- Anthropic supported.
- preferred provider configurable.
- one model configured per provider.
- provider fallback works.
- plans use structured output.
- plans are locally validated.
- manual capture works without AI.

## Workflows

- YAML workflow schema implemented.
- built-in workflows work.
- custom workflow directories work.
- individual imported workflow files work in place.
- filesystem watching works.
- manual Refresh works.
- parameters render automatically.
- semantic actions work.
- explicit waits work.
- pauses work.
- limited selector actions work.
- retry rules work.
- continue-on-error works.

## Fixtures

- bundled fixtures copy into temporary workspaces.
- custom fixtures can run in place.
- custom fixtures can request copying.
- successful temp workspaces clean up.
- failed/cancelled debug workspaces remain available.

## Screenshots

- App Content Only works.
- Full App Window works.
- semantic-region capture works.
- locator capture works.
- PNG download works.
- screenshot Copy works.

## Video

- renderer recording works.
- native full-window recording works.
- explicit recording boundaries work.
- whole-workflow recording works.
- MP4/H.264 conversion works.
- 30 FPS output works.
- silent output works.

## GIF

- GIF generation works.
- GIF cropping works.
- GIF resizing works.
- GIF download works.

## Cursor

- hidden works.
- visible works.
- smooth synthetic cursor works.

## Live Preview

- current workflow step is visible.
- periodic Bruno screenshots are shown.
- preview switches to final result after completion.

## Run Management

- only one run executes at once.
- starting another prompts for cancellation.
- Cancel Run works.
- failed steps are clearly reported.
- safe actions retry once.
- side-effecting actions do not automatically retry.

## Artifacts

- each run has an immutable folder.
- manifest is stored.
- workflow snapshot is stored.
- captures persist until deletion.
- newest-first Library works.
- filtering works.
- single download works.
- ZIP download works.
- Delete Capture works.
- Regenerate Exact works.
- Regenerate Latest works.

---

# 101. Recommended Implementation Sequence

## Phase 1 — Core Runtime

Implement:

- pnpm workspace
- shared types
- Zod schemas
- local Fastify server
- React shell
- settings persistence
- system status
- artifact structure

## Phase 2 — Bruno Automation

Implement:

- Bruno discovery
- Playwright Electron launch
- existing-instance detection
- CDP attach
- relaunch flow
- page/window discovery
- semantic action registry

## Phase 3 — Screenshot Vertical Slice

Implement:

- fixture handling
- workflow loader
- workflow runner
- screenshot steps
- App Content Only
- region/locator capture
- artifact manifest
- live preview
- Runner workflow

At this point Bruno Capture should already produce useful screenshots without AI.

## Phase 4 — Workflow UX

Implement:

- Workflows screen
- custom directories
- imported files
- file watching
- parameter forms
- workflow validation
- manual execution

## Phase 5 — Video/GIF

Implement:

- Playwright screencast
- ScreenCaptureKit helper
- Screen Recording permission flow
- FFmpeg adapter
- MP4/H.264
- GIF
- recording boundaries
- region cropping
- synthetic cursor

## Phase 6 — AI Planning

Implement:

- provider abstraction
- Keychain secrets
- OpenAI
- Anthropic
- structured plans
- repair
- confidence
- provider fallback
- Capture prompt UX

## Phase 7 — Library and Regeneration

Implement:

- Library
- filters
- downloads
- ZIP
- delete
- Regenerate Exact
- Regenerate Latest
- Reveal in Finder

## Phase 8 — MVP Workflow Coverage

Add and harden:

- Runner
- Request Execution
- OpenAPI Sync
- Environments
- Timeline

---

# 102. Primary Engineering Principles

## Determinism over autonomy

The AI selects from capabilities.

It does not invent automation.

## Semantic actions over selectors

Selectors are implementation details, not the primary workflow abstraction.

## Wait for state, not time

Use postconditions for synchronization.

Use pauses only for presentation.

## One workflow model for every output

Screenshots, videos, and GIFs should share the same execution engine.

## Local first

Artifacts, fixtures, credentials, and automation remain local unless an AI planning request explicitly needs constrained metadata.

## Reproducibility

Every run preserves:

- workflow snapshot
- parameters
- capture configuration
- Bruno build information
- provider/model information
- artifact metadata

## Graceful degradation

AI, FFmpeg, or native capture failures must not unnecessarily disable unrelated features.

---

# 103. Post-MVP Roadmap

Potential future capabilities:

- isolated Bruno profile per run
- Windows support
- Linux support
- 60 FPS video
- audio recording
- automated documentation integration
- batch screenshot refresh
- stale screenshot detection
- first-class CI execution
- visual regression
- local AI providers
- AI-assisted workflow creation with validation
- autonomous visual fallback
- deeper native UI automation
- screenshot annotations
- arrows
- highlights
- numbered callouts
- blur/redaction
- video zoom effects
- captions
- title cards
- automated cuts
- direct publishing integrations
- shareable artifact links
- packaged Bruno Capture desktop app
- workflow YAML editor
- visual workflow builder
- run queue
- parallel captures
- automatic Bruno-state restoration
- storage-management policies

---

# 104. Final MVP Definition

The MVP succeeds if a Bruno team member can open Bruno Capture, type:

> Create a GIF showing a collection being run in the Bruno Runner.

and Bruno Capture can:

1. interpret the request
2. choose a registered deterministic workflow
3. show the proposed plan
4. allow parameter adjustment
5. connect to Bruno
6. configure the application deterministically
7. execute the workflow
8. display a live preview
9. animate a deterministic cursor
10. record the relevant portion
11. produce the final GIF
12. store the workflow and configuration used
13. show the result in the browser
14. provide a one-click download
15. allow exact or latest regeneration later

The same execution architecture must also support documentation screenshots and MP4 feature demonstrations without creating separate automation systems.