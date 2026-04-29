export const DEFAULT_CENTER = [127.592328, 34.900905];
export const DEFAULT_BEARING = -38;
export const DEFAULT_PITCH = 0;
export const DEFAULT_GRID_ROTATION = -52;
export const DEFAULT_GRID_OFFSET_Y = 12;
export const DEFAULT_GRID_SIZE_METERS = 10;
export const DRAWING_SNAP_METERS = 1;
export const MAX_GRID_RENDER_LINES = 1000;
export const RAW_MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
export const MAPBOX_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
export const MAPBOX_GL_CSS_ID = "mapbox-gl-css";
export const MAPBOX_GL_SCRIPT_ID = "mapbox-gl-script";
export const KOREAN_LABEL_FIELD = ["coalesce", ["get", "name_ko"], ["get", "name"]];
export const GRID_SOURCE_ID = "echotech-grid-source";
export const GRID_LAYER_ID = "echotech-grid-layer";
export const MEASURE_SOURCE_ID = "echotech-measure-source";
export const MEASURE_LINE_LAYER_ID = "echotech-measure-line-layer";
export const MEASURE_FILL_LAYER_ID = "echotech-measure-fill-layer";
export const MEASURE_POINT_LAYER_ID = "echotech-measure-point-layer";
export const MEASURE_LABEL_LAYER_ID = "echotech-measure-label-layer";

export const MEASURE_MODES = {
  none: "none",
  rectangle: "rectangle",
  imageBlock: "imageBlock",
  polygon: "polygon",
  circle: "circle",
};

export const BLOCK_COLOR_PALETTE = ["#e11d48", "#ff7a18", "#f4b400", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#94a3b8"];
export const DEFAULT_BLOCK_COLOR = BLOCK_COLOR_PALETTE[0];
