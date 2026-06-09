# WorldEditor — User Manual

## Overview

WorldEditor is an autonomous driving road network editor that supports creating, editing, and exporting OpenDRIVE-format HD maps. It runs as a native desktop application (Tauri) and in web browsers (WASM).

**Current Version**: 0.3.0 (Phase 2 — Point Cloud, 3D Models & Collaboration)

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
┌─────────────────────────────────────────────────────────────┐
│  Menu Bar   [File] [Edit] [View] [Tools] [Plugins] [Help]  │
│  Toolbar    [New][Open][Save][SaveAs]|[Undo][Redo]|[Modes] │
├────────────┬─────────────────────────────────┬─────────────┤
│            │                                 │             │
│  Layer /   │         Viewport (3D/2D)         │  Property  │
│ Navigator  │                                 │   Panel    │
│   Panel    │                                 │            │
│            │                                 │            │
│  Template  ├─────────────────────────────────┤            │
│   Panel    │         Status Bar              │            │
└────────────┴─────────────────────────────────┴────────────┘
```

### Panels

| Panel | Description |
|-------|-------------|
| **Layer / Navigator Panel** | Road and junction hierarchy tree, map info, display settings |
| **Template Panel** | Predefined road/junction/signal/marking templates — drag or click to insert |
| **Viewport** | 3D/2D rendering of the road network; supports pan, orbit, zoom |
| **Property Panel** | Editable properties for the selected road or junction |
| **Status Bar** | Road/junction count, cursor coordinates, save status |

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

### Edit Modes

| Mode | Description | Shortcut |
|------|-------------|----------|
| **Select** | Default selection — click to select road/junction | S |
| **Road Edit** | Road editing mode — hover highlights road, click selects | R |
| **Lane Edit** | Lane editing mode — hover highlights individual lane, click selects | L |
| **LaneSection Edit** | Lane-cluster (LaneSection) editing mode — hover/select lane sections | J |
| **Spline** | Spline drawing mode — click to add knots | P |

### Draw Tools

| Tool | Description |
|------|-------------|
| Line | Draw a straight road (click 2 points) |
| Arc | Draw a curved road (click 3 points: start, through, end) |
| Spiral | Draw a clothoid/Euler spiral transition curve |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo |
| Ctrl+Y | Redo |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+N | New project |
| Ctrl+O | Open file |
| Ctrl+A | Select all |
| Ctrl+D | Duplicate selected road |
| Delete | Delete selected |
| Esc | Cancel selection / exit edit mode |
| E | Enter geometry edit for selected road |
| Home | Zoom to fit all |
| F | Zoom to selected |
| S | Select mode |
| R | Road edit mode |
| L | Lane edit mode |
| J | LaneSection edit mode |
| P | Spline draw mode |
| ? | Show this shortcut help |
| L (Navigator) | Toggle layer/navigator panel |
| I | Toggle property panel |

---

## File Operations

### Opening Files

- **File > Open File... (Ctrl+O)** — open an OpenDRIVE `.xodr` file
- **File > Open Recent Files...** — open a recently used file directly without a dialog
- **Drag and drop** — drag `.xodr` files into the viewport to open
- A loading progress bar appears during parsing for large files (uses Web Worker for non-blocking parsing)
- If a recent file no longer exists, it will be removed from the list and a notification will appear

### Closing Files

- **File > Close File (Ctrl+W)** — close the current project
- If unsaved changes exist, a confirmation dialog will prompt to save or discard

### Saving Files

- **File > Save (Ctrl+S)** — save the current project (overwrites the opened file)
- **File > Save As... (Ctrl+Shift+S)** — save to a new file path
- **Toolbar Save As button** — quick access to Save As

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
| GeoZ (ZIP+protobuf) | Import | GeoZ Importer | 🔧 |
| XODR Extensions | Import / Export | XODR Ext | ✅ |
| DXF (CAD) | Import / Export | DXF I/O | 📋 |
| Shapefile | Import / Export | Shapefile I/O | 📋 |
| SUMO | Import / Export | SUMO I/O | 📋 |

> **Note**: Items marked 📋 are planned for Phase 3 and not yet available.

---

## Road Editing

### Creating Roads

1. Select a draw tool from the toolbar (Line, Arc, or Spiral)
2. Click in the viewport to place geometry points
3. For Line: click start point, click end point
4. For Arc: click start, through-point, end
5. For Spiral: click start and end (curvature parameters auto-calculated)
6. A new road appears in the navigator panel

### Editing Road Geometry

1. Select a road (Select mode, click on it)
2. Press **E** or click "Edit Geometry" in the Property Panel
3. Control points appear on the road
4. Drag control points to reshape
5. Press **E** again or click "Finish Editing" to commit

### Moving / Rotating Roads

Use **Edit > Move Road** or **Edit > Rotate Road** after selecting a road.

### Splitting & Welding Roads

Found under **Edit** menu (Road Tools):
- **Split Road at Midpoint** — splits the selected road at its midpoint
- **Weld Roads** — merges two selected roads with compatible endpoints

### Road Properties

When a road is selected, the **Property Panel** shows:
- Road ID and Name
- Total length
- Junction reference
- **Geometry segments** — type (Line/Arc/Spiral), position, heading, length
- **Lane Sections** — list of lane sections with per-lane configuration

### Lane Editing

In the Property Panel > Lanes section:
- Each **Lane Section** shows left and right lanes
- Click **Delete Lane** to remove a lane
- Click **+L** / **+R** to add a lane on the left or right side
- Click **Edit** to modify lane width, type, road marks, etc.

### Lane Types

| Type | Description |
|------|-------------|
| Driving | Normal vehicle lane |
| Sidewalk | Pedestrian walkway |
| Biking | Bicycle lane |
| Shoulder | Road shoulder |
| Parking | Parking area |
| Median | Divided highway median |
| None / Border | Non-drivable edge |

---

## Elevation Editing ✅

Edit the vertical profile of roads using elevation control points.

### Editing Elevation

1. Select a road in Road Edit mode
2. Open the **Property Panel > Elevation Profile** section
3. Click **Edit Elevation** to enter elevation editing mode
4. Existing elevation points appear along the road centerline
5. **Add point**: Click on the road to insert a new elevation point
6. **Move point**: Drag an elevation point up/down to change height
7. **Delete point**: Select a point and press Delete
8. **Smooth**: Use the smooth tool to interpolate between adjacent points

### Elevation Properties

Each elevation point has cubic polynomial parameters:
- **s**: Station position along the road
- **a, b, c, d**: Cubic coefficients defining the profile

### Grade Display

The Property Panel shows:
- Current grade (slope) at the selected position
- Maximum/minimum grade values for the road
- Total elevation change

---

## Spline Editing ✅

Edit road centerlines using B-spline or Catmull-Rom curves.

1. Enter **Spline mode** (P key)
2. Click to place control knots in the viewport
3. The road reference line updates in real-time as you add knots
4. **Tangent handles**: Drag the tangent handles on each knot to adjust curvature
5. Press **Enter** to commit the spline as a road geometry

### Tangent Handle Editing

When editing spline knots, tangent handles allow fine control over curve direction:
- Drag handle endpoints to change the tangent direction
- Hold **Shift** while dragging to maintain symmetry between in/out tangents
- The spline automatically re-evaluates as handles move

---

## Gizmo Transforms 🔧

Interactive 3D transform handles for moving and rotating objects in the viewport.

### Translation Gizmo

- After selecting a road or object, the translation gizmo appears
- Drag the colored arrows (red = X, green = Y, blue = Z) to move along an axis
- Drag the colored planes between arrows to move in a plane

### Rotation Gizmo

- Switch to rotation mode via the toolbar or Edit menu
- Drag the colored rings to rotate around an axis

---

## Bridge & Tunnel Management ✅

Mark road segments as bridges or tunnels.

### Creating a Bridge

1. Select a road in Road Edit mode
2. In the **Property Panel**, find the **Bridge / Tunnel** section
3. Click **Add Bridge** and specify the start/end station (s-range)
4. The viewport highlights the bridge segment with elevated rendering

### Creating a Tunnel

1. Same as Bridge, but click **Add Tunnel**
2. Tunnel segments render with a semi-transparent overlay

### Properties

- **s_start / s_end**: Station range of the bridge/tunnel
- **type**: Bridge or Tunnel
- **name**: Optional label

---

## Junction Templates ✅

Automatic generation of junction connector roads with configurable topologies.

### Available Templates

| Template | Description |
|----------|-------------|
| T-Junction | 3-arm intersection with driving connectors |
| Cross Junction (4-way) | 4-arm intersection with full pair connectivity |
| Roundabout | Ring road with entry/exit connectors per arm |
| Roundabout 4 | 4-arm roundabout with arc-gap architecture |

### Placing a Junction

1. Open the **Template Panel** (left side)
2. Select a junction template
3. Click in the viewport to place — connector roads are auto-generated
4. Each placement is a single undo entry

### Connector Roads

- Connectors are automatically generated per-lane matching the C# reference
- Arm placement follows radial positioning for T/Cross topologies
- Roundabouts use arc-gap architecture with ring shoulder lanes

---

## Shape Vector Layer Editing ✅

Draw and edit custom vector shapes on the map (polygons, rectangles, circles).

1. Open the **Shape Editor** from the Tools menu
2. Select a shape tool (polygon, rectangle, circle)
3. Click in the viewport to place vertices
4. Close the shape by clicking the first vertex or pressing Enter
5. Edit existing shapes by selecting and dragging vertices

---

## Snapping ✅

Magnetic snapping helps align roads and geometry precisely.

| Snap Target | Description |
|-------------|-------------|
| Road endpoint | Snap to the start/end of nearby roads |
| Junction | Snap to junction connection points |
| Grid | Snap to the viewport grid intersections |

Snapping is enabled by default and can be toggled in the status bar or via **View > Snapping**.

---

## Soft Selection 🔧

When editing multiple control points, soft selection applies a gaussian falloff influence to neighboring points.

1. Enable soft selection in the **Advanced Editing** plugin panel
2. Set the **brush radius** to control the area of influence
3. Set the **falloff curve** to control how influence decreases with distance
4. When moving a control point, nearby points move proportionally

---

## Templates

The **Template Panel** (left side) provides predefined presets:

- **Roads** — Single lane, 2-lane, 4-lane, highway, urban, on-ramp
- **Junctions** — T-junction, 4-way (+), roundabout, etc.
- **Signals** — Traffic lights, stop signs, speed limits
- **Markings** — Solid/dashed white/yellow, zebra crossing
- **Favorites** — Pin frequently used presets here for quick access

**Usage:**
- Click a template to insert at the scene origin
- Drag a template into the viewport to place at a specific position

---

## Navigation in Viewport

| Action | Gesture |
|--------|---------|
| Pan | Middle mouse button drag / right-click drag |
| Zoom | Scroll wheel |
| Orbit (3D) | Left-click drag in 3D mode |
| Select | Left-click in Select mode |
| Multi-select | Shift+click or Shift+drag (rubber band) |
| Zoom to Fit | Home key |
| Zoom to Selected | F key |

---

## Measurement Tools

Found under **Tools** menu and accessible via the toolbar Measure button:

- **Distance** — click 2 points to measure straight-line distance
- **Angle** — click 3 points to measure angle
- **Area** — click multiple points to measure enclosed area

---

## Display Settings

In the **Navigator Panel > Display Settings** section:

| Setting | Description |
|---------|-------------|
| Road Mesh | Show/hide 3D road surface |
| Lane Lines | Show/hide lane divider lines |
| Road Marks | Show/hide surface markings (arrows, crosswalks) |
| Reference Line | Show/hide OpenDRIVE reference centerline |
| Signals | Show/hide traffic signs and signals |
| Objects | Show/hide road objects (guardrails, etc.) |
| Color Mode | Single / By Road / By Lane Type coloring |

---

## Plugins

Plugins extend the editor with additional functionality. Access via **Plugins > Plugin Manager**.

### Built-in Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| Road Tools | Road editing toolbar and Edit menu items | ✅ |
| Built-in Templates | Road, junction, signal, marking templates | ✅ |
| Advanced Editing | Soft selection, constraint movement, tangent handles | ✅ |
| Scripting | JavaScript/Python scripting engine for automation | 🔧 |
| CSV I/O | Import/export roads as CSV | ✅ |
| Lanelet2 I/O | Import/export Lanelet2 HD maps | 🔧 |
| MIF I/O | Import/export MapInfo MIF format | ✅ |
| NIO I/O | Import/export NIO protocol buffer format | 🔧 |
| OBJ 3D | Export 3D mesh to OBJ format | ✅ |
| OSM Export | Export to OpenStreetMap format | ✅ |
| Signal JSON | Import/export signal configuration JSON | ✅ |
| GeoZ (ZIP+protobuf) | Import GeoZ archive format | 🔧 |
| XODR Extensions | Extended OpenDRIVE operations | ✅ |
| Converter | Format conversion pipeline | 🔧 |
| DXF I/O | Import/export DXF CAD format | 📋 |
| Shapefile I/O | Import/export Shapefile format | 📋 |
| GIS Tools | Coordinate converter, CRS setup, projection | ✅ |
| Validation | OpenDRIVE data quality and topology checks | ✅ |
| Lane Detect | Automatic lane detection from road geometry | 🔧 |
| Traffic | Signal phasing, timing analysis | 🔧 |
| Ecosystem | Integration with external ecosystem tools | 🔧 |
| Point Cloud | Point cloud loading and visualization (desktop only) | 📋 |
| Satellite | OSM/satellite imagery overlay | 📋 |
| 3D Models | 3D model import and placement | 📋 |

---

## Auto-Update

WorldEditor checks for updates on startup. When a new version is available:
- A notification appears in the status bar
- Click **Help > Check for Updates** to manually check
- Follow the prompt to download the latest release

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Viewport shows blank / "WebGPU not supported" | Update your browser/GPU drivers; use Chrome 113+ or Edge 113+ |
| File fails to parse | Ensure the file is valid OpenDRIVE 1.6 XML |
| Recent file shows "not found" | File was moved or deleted; the entry is removed automatically |
| WASM features unavailable | In web mode, some features require the WASM backend to be built and served |
| Desktop app won't start | Check GPU drivers; disable hardware acceleration if needed |

---

## Getting Help

- **Help > User Manual** — open this document online
- **Help > About WorldEditor** — show version information
- **?** key — show keyboard shortcut reference
- GitHub Issues: report bugs or request features in the project repository

---

*WorldEditor — Built with Rust + TypeScript, powered by Tauri and wgpu*
