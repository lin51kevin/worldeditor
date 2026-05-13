# WorldEditor Next — User Manual

## Overview

WorldEditor Next is an autonomous driving road network editor that supports creating, editing, and exporting OpenDRIVE-format HD maps. It runs as a native desktop application (Tauri) and in web browsers (WASM).

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
- If a recent file no longer exists, it will be removed from the list and a notification will appear

### Saving Files

- **File > Save (Ctrl+S)** — save the current project (overwrites the opened file)
- **File > Save As... (Ctrl+Shift+S)** — save to a new file path
- **Toolbar Save As button** — quick access to Save As

### Import / Export

Found under **File > Import** and **File > Export**:

| Format | Direction | Plugin |
|--------|-----------|--------|
| OpenDRIVE (.xodr) | Import / Export | Built-in |
| CSV | Import / Export | CSV I/O |
| Lanelet2 | Import / Export | Lanelet2 I/O |
| OBJ 3D | Export | OBJ 3D Export |
| OSM | Export | OSM Export |
| Signal JSON | Import / Export | Signal JSON I/O |
| GeoZ (ZIP+protobuf) | Import | GeoZ Importer |

> **Note**: Some formats are currently placeholder implementations and will be enabled in future releases.

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

| Plugin | Description |
|--------|-------------|
| Road Tools | Road editing toolbar and Edit menu items |
| Built-in Templates | Road, junction, signal, marking templates |
| Advanced Editing | Split, weld, optimize, deploy operations |
| CSV I/O | Import/export roads as CSV |
| Lanelet2 I/O | Import/export Lanelet2 HD maps |
| GIS Tools | Coordinate converter, CRS setup |
| Validation | OpenDRIVE data quality and topology checks |
| Traffic | Signal phasing, timing, SUMO I/O |
| Point Cloud | Point cloud loading (desktop only) |
| Satellite | OSM/satellite imagery overlay (desktop only) |

---

## Auto-Update

WorldEditor Next checks for updates on startup. When a new version is available:
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

*WorldEditor Next — Built with Rust + TypeScript, powered by Tauri and wgpu*
