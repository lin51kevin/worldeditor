# WorldEditor Next — User Manual

> **Online version**: [https://github.com/lin51kevin/worldeditor/blob/master/docs/user-manual.md](https://github.com/lin51kevin/worldeditor/blob/master/docs/user-manual.md)

## Overview

WorldEditor Next is an autonomous driving road network editor that supports creating, editing, and exporting OpenDRIVE-format HD maps. It runs as a native desktop application (Tauri 2.0) and in web browsers (WebAssembly / WebGPU).

**Current Version**: 0.3.0 (Phase 2 — Point Cloud, 3D Models & Collaboration)

### System Requirements

| Platform | Requirement |
|----------|-------------|
| Desktop (Windows / macOS / Linux) | Tauri 2.0 runtime, GPU with Vulkan / Metal / DX12 support |
| Web Browser | Chrome 113+, Edge 113+, or any browser with WebGPU enabled |
| GPU Drivers | Up-to-date drivers required for WebGPU rendering |

### Feature Status Legend

Throughout this manual, features are marked with their current status:

| Icon | Status | Description |
|------|--------|-------------|
| ✅ | Stable | Fully implemented and tested |
| 🔧 | Experimental | Implemented but may have rough edges |
| 📋 | Planned | Not yet available, coming in a future release |

---

## Interface Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Menu Bar   [File] [Edit] [Road] [View] [Tools] [Plugins] [Help]           │
│  Toolbar    [New][Open][Save][SaveAs] | [Undo][Redo] | [Modes] | [Tools]  │
├──────────────┬──────────────────────────────────────┬───────────────────────┤
│              │                                      │                       │
│  Layer /     │          Viewport (3D / 2D)           │   Property Panel      │
│  Navigator   │                                      │   (road / lane /      │
│  Panel       │                                      │    junction props)    │
│              │                                      │                       │
│  Template    ├──────────────────────────────────────┤   AI Copilot Panel    │
│  Panel       │           Status Bar                 │   (right side)        │
└──────────────┴──────────────────────────────────────┴───────────────────────┘
```

### Panels

| Panel | Shortcut | Description |
|-------|----------|-------------|
| **Layer / Navigator Panel** | Ctrl+B | Road/junction hierarchy tree, map info, display settings |
| **Template Panel** | — | Predefined road/junction/signal/marking templates |
| **Viewport** | — | 3D/2D rendering canvas; pan, orbit, zoom |
| **Property Panel** | I | Editable properties for the selected road, lane, or junction |
| **AI Copilot Panel** | — | AI-powered assistant for natural-language editing commands |
| **Output Panel** | — | Log of plugin and command output messages |
| **Status Bar** | — | Road/junction count, cursor world coordinates, save indicator |

---

## File Operations

### Opening Files

- **File > Open File... (Ctrl+O)** — open an OpenDRIVE `.xodr` file via the system file dialog
- **File > Open Recent Files...** — open a recently used file directly without a dialog (auto-removes missing entries)
- **Drag and drop** — drag any `.xodr` file into the viewport to open it
- Large files are parsed in a Web Worker so the UI remains responsive

### Closing & Saving

| Action | Shortcut | Description |
|--------|----------|-------------|
| New | Ctrl+N | Create a blank project |
| Open | Ctrl+O | Open file dialog |
| Save | Ctrl+S | Overwrite the current file |
| Save As | Ctrl+Shift+S | Save to a new path |
| Close File | Ctrl+W | Close the current project (prompts if unsaved) |
| Exit | — | Close the application |

If the project has unsaved changes (`*` in title bar), a confirmation dialog appears before closing.

### Import / Export

Found under **File > Import** and **File > Export**:

| Format | Direction | Plugin | Status |
|--------|-----------|--------|--------|
| OpenDRIVE (.xodr) | Import / Export | Built-in | ✅ |
| CSV | Import / Export | CSV I/O | ✅ |
| Lanelet2 | Import / Export | Lanelet2 I/O | 🔧 |
| MIF (MapInfo) | Import / Export | MIF I/O | ✅ |
| NIO (protobuf) | Import / Export | NIO I/O | 🔧 |
| OBJ 3D | Export | OBJ 3D Export | ✅ |
| OSM | Export | OSM Export | ✅ |
| Signal JSON | Import / Export | Signal JSON I/O | ✅ |
| GeoZ (ZIP + protobuf) | Import | GeoZ Importer | 🔧 |
| XODR Extensions | Import / Export | XODR Ext | ✅ |
| DXF (CAD) | Import / Export | DXF I/O | 📋 |
| Shapefile | Import / Export | Shapefile I/O | 📋 |
| SUMO | Export | SUMO I/O | 📋 |

> Items marked 📋 are planned for Phase 3 and not yet available.

---

## Toolbar Quick Actions

| Button | Action | Shortcut |
|--------|--------|----------|
| New | Create new project | Ctrl+N |
| Open | Open file | Ctrl+O |
| Save | Save current project | Ctrl+S |
| Save As | Save with a new name | Ctrl+Shift+S |
| Undo | Undo last action | Ctrl+Z |
| Redo | Redo undone action | Ctrl+Y |
| Zoom to Fit | Zoom viewport to show all roads | F |
| Select Mode | Default click-to-select | V |
| Move Road | Translate selected road | M |
| Rotate Road | Rotate selected road | R |
| Spline Draw | Enter spline knot placement | S |
| Toggle Inspector | Show/hide Property Panel | I |
| Toggle Left Panel | Show/hide Layer/Navigator Panel | Ctrl+B |

The toolbar is **draggable** — click and drag the grip area to reposition it anywhere on screen. Its position is persisted across sessions.

### Selection Mode (Road / LaneSection / Lane)

Use the **Selection Mode** toggle in the toolbar or status bar to switch what is highlighted and selected on click:

| Mode | Keyboard | Highlights |
|------|----------|------------|
| Road | — | Entire road |
| LaneSection | — | Individual lane-section block |
| Lane | — | Single lane strip |

### View Mode

Switch between rendering styles via the **View Mode** button:

| Mode | Description |
|------|-------------|
| Solid | Filled road surface with lane colors |
| Sketch | Outline-style rendering, no fill |
| Wireframe | Mesh edges only |

### 2D / 3D Toggle

Switch between top-down 2D view and full 3D perspective view via **View > 3D View / 2D View** or the toolbar dimension toggle.

---

## Navigation in Viewport

| Action | Gesture |
|--------|---------|
| Pan | Middle-mouse drag or right-click drag |
| Zoom | Scroll wheel |
| Orbit (3D) | Left-click drag in 3D mode |
| Select | Left-click in Select mode |
| Rubber-band select | Shift + drag |
| Multi-select (add) | Shift + click |
| Zoom to Fit | F key |
| Zoom to Selected | F key (with selection) |
| Context menu | Right-click on road/junction |

---

## Road Editing ✅

### Creating Roads

1. Select a draw geometry from the toolbar (**Line**, **Arc**, or **Spline**)
2. Click in the viewport to place geometry points
3. **Line**: click start → click end
4. **Arc**: click start → through-point → end (3-click arc)
5. **Spline**: place knots, press Enter to commit (see [Spline Editing](#spline-editing-))
6. The new road appears in the Navigator Panel and is immediately selectable

### Editing Road Geometry

1. Select a road in the viewport
2. Press **E** or click **Edit Geometry** in the Property Panel
3. Control points appear along the reference line
4. Drag control points to reshape
5. Press **E** again or **Finish Editing** to commit the new geometry

### Moving & Rotating Roads

| Action | How |
|--------|-----|
| Move Road | Select road → press M (or toolbar) → drag |
| Rotate Road | Select road → press R (or toolbar) → drag |
| Move to exact position | Property Panel > Geometry > enter values |

### Splitting Roads

| Method | How |
|--------|-----|
| Split at Point (click) | Select road → press X → click on the road to place split point |
| Split at Midpoint | Road menu > Split Road at Midpoint (Ctrl+Shift+X) |
| Split with Junction | Road menu > Split Road at Junction |

Splitting produces two roads sharing a junction at the split point.

### Welding Roads

Select **two or more roads** with compatible endpoints, then:
- Toolbar button: **Weld Roads**
- Menu: **Road > Weld Roads**

The roads are merged into a single road with a blended geometry.

### Resample Road

Road menu > **Resample Road** — re-distributes geometry samples at uniform intervals for smoother rendering and operations.

### Optimise Lane Geometry

Road menu > **Optimise Lane Geometry** — removes redundant control knots while preserving the road shape.

### Road Properties (Property Panel)

When a road is selected:

| Field | Description |
|-------|-------------|
| Road ID | Unique identifier (read-only) |
| Name | User-editable road name |
| Length | Total road length in metres |
| Junction | Junction reference (if inside a junction) |
| Geometry Segments | Type (Line/Arc/Spiral), position, heading, length per segment |
| Lane Sections | List of lane sections with per-lane configuration |
| Bridge/Tunnel | Bridge or tunnel segments along this road |
| Signals | Signals placed on this road |
| Objects | Road objects (guardrails, cones, etc.) |
| Crossfall | Lateral superelevation profile |
| Elevation | Vertical elevation profile |

---

## Lane Editing ✅

In **Property Panel > Lanes**:

- Each **Lane Section** lists left lanes (negative IDs) and right lanes (positive IDs)
- Click **+L** / **+R** to add a lane on the left or right side
- Click **Delete Lane** to remove a lane
- Click **Edit** to open the lane detail editor (width, type, road marks)

### Lane Types

| Type | Description |
|------|-------------|
| Driving | Normal vehicle lane |
| Sidewalk | Pedestrian walkway |
| Biking | Bicycle lane |
| Shoulder | Road shoulder / hard strip |
| Parking | Parking area |
| Median | Divided highway median |
| Restricted | No-entry zone |
| None / Border | Non-drivable edge |
| Stop | Stop line zone |
| Crosswalk | Pedestrian crossing |

### Lane Line Editing

1. Select a lane (Lane selection mode)
2. Click the **Edit Lane Line** button in the Road Edit Toolbar
3. Drag control points on the lane boundary to reshape the line
4. Confirm to commit

### Standard Markings

Road menu > **Apply Standard Markings** — automatically assigns standard OpenDRIVE road marks (solid/dashed white/yellow) to all lanes based on their type and driving side.

---

## Elevation Editing ✅

Edit the vertical profile of a road using cubic polynomial elevation points.

1. Select a road
2. Open **Property Panel > Elevation Profile**
3. Click **Edit Elevation** to enter elevation mode
4. **Add point**: click on the road
5. **Move point**: drag up/down
6. **Delete point**: select → Delete key
7. **Smooth**: use the smooth tool to interpolate between adjacent points

### Elevation Properties

Each elevation point stores cubic coefficients `a, b, c, d` over station `s`. The Property Panel shows current grade, max/min grade, and total elevation change.

---

## Crossfall / Superelevation Editing 🔧

Edit the lateral slope (cross-slope / superelevation) of road surfaces.

1. Select a road
2. Open **Property Panel > Crossfall** (or use the **Crossfall Editor** panel)
3. Add superelevation records specifying station `s` and lateral slope values for each lane
4. The 3D viewport reflects the tilt in real time

---

## Spline Editing ✅

Edit road centerlines using B-spline / Catmull-Rom curves.

1. Press **S** or click the **Spline Draw** toolbar button
2. Click in the viewport to place control knots
3. The road reference line updates in real time
4. Drag **tangent handles** on each knot to adjust curvature direction
   - Hold **Shift** to mirror the in/out tangent symmetrically
5. Press **Enter** (or **Finish**) to commit the spline as final road geometry

---

## Road Marking Editing ✅

Fine-tune individual road mark records per lane section.

1. Select a road, then a lane section
2. Open **Property Panel > Road Marks** (or the **Road Marking Panel**)
3. Each mark record shows: type (solid/dashed/…), color, weight, lane change permission
4. Click **+** to add a new mark record; click the trash icon to remove
5. Changes are immediately reflected in the viewport

### Auto-Deploy Markings

| Operation | Road menu item |
|-----------|----------------|
| Deploy sidewalks | Advanced Editing > Auto Deploy Sidewalks |
| Deploy crosswalks | Advanced Editing > Auto Deploy Crosswalks |
| Deploy stop lines | Advanced Editing > Auto Deploy Stop Lines |
| Apply standard marks | Road > Apply Standard Markings |

---

## Gizmo Transforms 🔧

Interactive 3D handles that appear when an object is selected.

### Translation Gizmo

- Colored arrows: drag red (X), green (Y), blue (Z) to constrain to one axis
- Colored planes: drag to move within a 2D plane

### Rotation Gizmo

- Switch via toolbar or Edit menu
- Drag colored rings (red / green / blue) to rotate around each axis

---

## Bridge & Tunnel Management ✅

Mark road segments as bridges or tunnels.

1. Select a road
2. **Property Panel > Bridge / Tunnel** — click **Add Bridge** or **Add Tunnel**
3. Enter start station (`s_start`) and end station (`s_end`)
4. Bridges render with elevated highlight; tunnels render with a semi-transparent overlay

Alternatively, use **Road menu > Add Bridge Section** or **Add Tunnel Section** to insert at the cursor position.

---

## Junction Editing ✅

### Creating Junctions from Templates

1. Open the **Template Panel** (left side)
2. Select a junction template (T-Junction, Cross, Roundabout, …)
3. Click or drag into the viewport — connector roads are auto-generated
4. Each placement creates a single undo entry

### Junction Templates

| Template | Description |
|----------|-------------|
| T-Junction | 3-arm intersection |
| Cross Junction (4-way) | 4-arm intersection with full connectivity |
| Roundabout | Ring road with configurable arm count |
| Roundabout 4 | 4-arm roundabout using arc-gap architecture |

### Auto-Create Junction from Roads

Select **two or more roads** whose endpoints are close, then:
- Toolbar button: **Create Junction from Selected Roads**
- Menu: **Road > Create Junction from Selected Roads**

The plugin calculates connector roads automatically.

### Edit Junction

1. Select a junction in the viewport
2. Enter **Edit Junction** mode (toolbar or Road menu)
3. Drag the junction polygon boundary to reshape it
4. Use **Rebuild Connections** to regenerate connector roads after changes

### Junction Operations (Road Menu)

| Operation | Description |
|-----------|-------------|
| Add Incoming Road | Connect a new road into an existing junction |
| Remove Incoming Road | Disconnect a road from the junction |
| Rebuild Junction Connections | Regenerate all connector roads for a junction |
| Fill Junction Gap | Fill a topological gap in connector roads |
| Build Junction Polygon | Re-triangulate the junction area polygon |

---

## Signal Placement ✅

### Placing Signals

1. Road menu > **Place Signal** (or toolbar signal button)
2. The cursor changes to a placement crosshair
3. Click on a road to place the signal at that station
4. The signal appears in the Property Panel > Signals list

### Signal Palette

The **Signal Palette** panel (bottom of left panel area) shows categorised signal types:
- Speed limits (5, 10, 20, 30, 40, 50, 60, 80, 100, 120 km/h)
- Warning signs
- Traffic lights
- Stop / give-way signs

Click a signal type in the palette, then click on the road to place it.

### Signal Properties

| Field | Description |
|-------|-------------|
| ID | Unique signal identifier |
| Type | OpenDRIVE signal type code |
| Value | Numeric value (e.g. speed limit) |
| s / t | Longitudinal station and lateral offset |
| Orientation | Facing direction (+/−) |
| Dynamic | Whether the signal is dynamic (traffic light) |

---

## Object Placement ✅

### Placing Road Objects

1. Road menu > **Place Object**
2. Click on a road to place the object
3. Select the object type from the popup list (guardrail, cone, barrier, sign, …)

### Object Properties

| Field | Description |
|-------|-------------|
| ID | Unique object identifier |
| Type | Object category (barrier, pole, sign, …) |
| s / t | Station and lateral offset |
| zOffset | Height above road surface |
| Orientation | Rotation angle |
| Length / Width / Height | Physical dimensions |

---

## Shape Vector Layer Editing ✅

Draw custom vector shapes as annotation or zone layers.

1. Tools menu > **Shape Editor** (or plugin panel)
2. Select a tool: **Polygon**, **Rectangle**, **Circle**
3. Click in the viewport to place vertices
4. Close the polygon by clicking the first vertex or pressing Enter
5. Edit existing shapes: select → drag vertices

Shapes are stored in the project as zone data and rendered as overlays.

---

## Snapping ✅

| Snap Target | Description |
|-------------|-------------|
| Road Endpoint | Snap to the start or end of nearby roads |
| Junction Point | Snap to junction connection nodes |
| Grid | Snap to visible grid intersections |

- Toggle snapping: **View > Snapping** or the magnet icon in the status bar
- Open **Snap Settings** (status bar gear icon) to enable/disable individual snap modes and adjust tolerance

---

## Soft Selection 🔧

Applies a Gaussian-falloff influence when editing multiple control points.

1. Enable **Soft Selection** in the Advanced Editing toolbar
2. Set the **Brush Radius** to control the area of influence
3. Set the **Falloff Curve** to linear, smooth, or sharp
4. When moving a control point, adjacent points move proportionally

---

## Template Panel ✅

The left-side Template Panel provides categorised presets:

| Category | Examples |
|----------|---------|
| Roads | Single-lane, 2-lane, 4-lane, highway, urban, on-ramp |
| Junctions | T-junction, 4-way (+), roundabout, roundabout-4 |
| Signals | Traffic lights, stop signs, speed limits |
| Markings | Solid/dashed white/yellow, zebra crossing, stop line |

**Usage:**
- Click to insert at the scene origin
- Drag into the viewport to place at a specific position
- All insertions create a single undo entry

---

## Measurement Tools ✅

Found under **Tools > Measure** or the ruler toolbar button:

| Tool | Usage |
|------|-------|
| Distance | Click 2 points — shows straight-line distance |
| Angle | Click 3 points — shows included angle |
| Area | Click multiple points and close — shows enclosed area |

Results appear in the **Measurement Panel** and persist until cleared.

---

## Display Settings ✅

In **Navigator Panel > Display Settings**:

| Setting | Description |
|---------|-------------|
| Road Mesh | Show/hide 3D road surface |
| Lane Lines | Show/hide lane divider lines |
| Road Marks | Show/hide surface markings (arrows, crosswalks) |
| Reference Line | Show/hide OpenDRIVE reference centerline |
| Signals | Show/hide traffic signs and signals |
| Objects | Show/hide road objects (guardrails, cones, etc.) |
| Grid | Show/hide viewport grid |
| Axis | Show/hide world axis indicator |
| Hover Highlight | Highlight road under cursor |
| Color Mode | Single / By Road / By Lane Type |

---

## Undo / Redo ✅

All editing operations are undoable. The undo/redo stacks use the **Command** pattern — each operation stores a before/after snapshot for reliable reversal.

| Action | Shortcut |
|--------|----------|
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |
| Reset to Last Save | File > Reset to Saved |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+N | New project |
| Ctrl+O | Open file |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+W | Close file |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+A | Select all |
| Ctrl+D | Duplicate selected road |
| Ctrl+B | Toggle left panel |
| Delete | Delete selected |
| Esc | Cancel selection / exit current mode |
| E | Enter / exit geometry edit for selected road |
| F | Zoom to fit / zoom to selected |
| V | Select mode |
| S | Spline draw mode |
| M | Move road mode |
| R | Rotate road mode |
| X | Split road at point (click on road) |
| Ctrl+Shift+X | Split road at midpoint |
| I | Toggle property panel |
| ? | Show shortcut help dialog |

---

## Plugins ✅

Plugins extend the editor with additional functionality. Manage via **Plugins > Plugin Manager**.

### Built-in Plugins

#### Editing

| Plugin | Description | Status |
|--------|-------------|--------|
| Road Tools | Road CRUD operations and Road menu items | ✅ |
| Advanced Editing | Split, weld, resample, optimise, auto-junction, signal/object placement, bridge/tunnel, markings auto-deploy, CRG support | ✅ |
| Built-in Templates | Road, junction, signal, marking presets | ✅ |
| Shape Editor | Custom polygon/rectangle/circle vector shapes | ✅ |
| Converter | Format conversion pipeline (chain importers/exporters) | 🔧 |

#### I/O

| Plugin | Description | Status |
|--------|-------------|--------|
| CSV I/O | Import/export roads as CSV | ✅ |
| Lanelet2 I/O | Import/export Lanelet2 HD maps | 🔧 |
| MIF I/O | Import/export MapInfo MIF format | ✅ |
| NIO I/O | Import/export NIO protocol buffer format | 🔧 |
| OBJ 3D | Export 3D mesh to OBJ format | ✅ |
| OSM Export | Export to OpenStreetMap format | ✅ |
| Signal JSON | Import/export signal configuration JSON | ✅ |
| GeoZ | Import GeoZ (ZIP + protobuf) archive | 🔧 |
| XODR Extensions | Extended OpenDRIVE import/export operations | ✅ |
| DXF I/O | Import/export DXF CAD format | 📋 |
| Shapefile I/O | Import/export Shapefile format | 📋 |
| SUMO | Export to SUMO traffic simulation | 📋 |

#### Analysis

| Plugin | Description | Status |
|--------|-------------|--------|
| Validation | OpenDRIVE data quality and topology checks | ✅ |
| Lane Detect | Automatic lane detection from road geometry | 🔧 |
| Traffic | Signal phasing and timing analysis | 🔧 |

#### GIS & Visualization

| Plugin | Description | Status |
|--------|-------------|--------|
| GIS Tools | Coordinate converter, CRS / projection setup, WGS84 / GCJ-02 / UTM / MGRS | ✅ |
| Satellite | OSM / satellite imagery background overlay | 📋 |
| 3D Models | Import and place 3D model assets in scene | 📋 |
| Point Cloud | Load and visualize LAS / PCD point clouds (desktop only) | 📋 |
| Ecosystem | Integration with external ecosystem tools | 🔧 |
| Scripting | JavaScript automation scripting engine | 🔧 |

---

## AI Copilot 🔧

The **AI Copilot** panel (accessible from the right-side panel tab) provides a conversational AI assistant for road editing.

### Features

- **Natural-language commands** — describe what you want ("add a 4-lane road from A to B") and the copilot generates the appropriate operations
- **Context-aware** — understands the current selection and project state
- **Command suggestions** — proposes next steps based on the editing context

### Opening the Copilot Panel

- Click the **AI Copilot** tab on the right side panel, or
- Toggle via **Plugins > AI Copilot**

---

## GIS Tools ✅

Access via **Tools > GIS Tools** or the GIS Tools plugin panel.

### Coordinate Converter

Convert between coordinate systems interactively:

| System | Support |
|--------|---------|
| WGS84 (GPS) | ✅ |
| GCJ-02 (China encrypted GPS) | ✅ |
| ECEF (Earth-Centred Earth-Fixed) | ✅ |
| ENU (East-North-Up local) | ✅ |
| UTM | ✅ |
| MGRS | ✅ |
| Proj4 / WKT CRS | ✅ |
| Ground Control Points (GCP) | ✅ |

### CRS Setup

Configure the project's coordinate reference system so that import/export operations use correct geospatial transforms. Set via **GIS Tools > Set CRS**.

---

## Converter 🔧

The **Converter** plugin (Tools > Converter) chains importers and exporters for batch conversion:

1. Select a **source format** and input file
2. Select a **target format** and output path
3. Click **Convert** — the conversion pipeline runs using the registered I/O plugins
4. Conversion log appears in the **Output Panel**

---

## Validation ✅

**Plugins > Validation** checks the current project for:

| Check | Description |
|-------|-------------|
| Topology | Dangling road endpoints, unconnected junction arms |
| Geometry | Degenerate curves, zero-length segments |
| Lane consistency | Missing lane continuity across lane sections |
| Signal placement | Signals outside road bounds |
| Road marks | Conflicting or invalid mark records |

Results appear in the **Output Panel**. Click an issue to select the offending element.

---

## Auto-Update ✅

WorldEditor checks for updates on startup and when you select **Help > Check for Updates**.

- **Desktop**: downloads and installs the update via the Tauri updater (signed packages)
- **Web**: notifies you to refresh the page when a new version is deployed

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Viewport shows blank / "WebGPU not supported" | Update GPU drivers; use Chrome 113+ or Edge 113+ |
| File fails to parse | Ensure the file is valid OpenDRIVE 1.4–1.6 XML |
| Recent file shows "not found" | File was moved/deleted; the entry is auto-removed |
| WASM features unavailable | In web mode some features require the WASM backend; check the build |
| Desktop app won't start | Update GPU drivers; try disabling hardware acceleration |
| Spline draw produces no road | Press Enter to commit the knots after placing them |
| Undo does nothing | Some plugin operations (e.g. display-only changes) are not undoable |
| Snapping not working | Check that snapping is enabled in the status bar |

---

## Getting Help

- **Help > User Manual** — open this document in your browser
- **Help > About WorldEditor** — show version, build date, and commit information
- **?** key — keyboard shortcut reference dialog
- **GitHub Issues**: [https://github.com/lin51kevin/worldeditor/issues](https://github.com/lin51kevin/worldeditor/issues)

---

*WorldEditor Next — Built with Rust + TypeScript, powered by Tauri 2.0, wgpu / WebGPU, and WebAssembly*
