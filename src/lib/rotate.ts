// @ts-ignore
import { parseSync, stringify } from "svgson";
// @ts-ignore
import { SVGPathData } from "svg-pathdata";
import { optimize } from "@/lib/optimize";
import memoize from "lodash/memoize";
import round from "lodash/round";
import { getPaths } from "./get-paths";

// Rotates all icon geometry 90 degrees clockwise (y-down screen coordinates)
// about the canvas center. Mirrors flip.ts: every segment from getPaths is
// transformed and re-emitted as its own <path>, then optimize() re-merges.
// Unlike flip, svg-path-commander is NOT used for the transform because it
// converts arcs to cubic curves; here arcs stay arcs.
const _rotate = (svg: string) => {
  const data = parseSync(svg);
  const paths = getPaths(svg);
  const height = data.attributes.height ? parseInt(data.attributes.height) : 24;
  const width = data.attributes.width ? parseInt(data.attributes.width) : 24;
  const cx = width / 2;
  const cy = height / 2;
  // (x, y) -> (cx - (y - cy), cy + (x - cx))
  const rx = (x: number, y: number) => round(cx - (y - cy), 4);
  const ry = (x: number, _y: number) => round(cy + (x - cx), 4);
  data.children = [];
  for (let i = 0; i < paths.length; i++) {
    // getPaths emits "M x y <single absolute segment>", but be defensive and
    // handle any absolute command.
    const commands = new SVGPathData(paths[i].d).toAbs().commands.map(
      (c: any) => {
        switch (c.type) {
          case SVGPathData.MOVE_TO:
          case SVGPathData.LINE_TO:
            return { ...c, x: rx(c.x, c.y), y: ry(c.x, c.y) };
          case SVGPathData.HORIZ_LINE_TO:
            // horizontal line becomes vertical
            return { type: SVGPathData.VERT_LINE_TO, relative: false, y: ry(c.x, 0) };
          case SVGPathData.VERT_LINE_TO:
            // vertical line becomes horizontal
            return { type: SVGPathData.HORIZ_LINE_TO, relative: false, x: rx(0, c.y) };
          case SVGPathData.CURVE_TO:
            return {
              ...c,
              x1: rx(c.x1, c.y1),
              y1: ry(c.x1, c.y1),
              x2: rx(c.x2, c.y2),
              y2: ry(c.x2, c.y2),
              x: rx(c.x, c.y),
              y: ry(c.x, c.y),
            };
          case SVGPathData.SMOOTH_CURVE_TO:
            return {
              ...c,
              x2: rx(c.x2, c.y2),
              y2: ry(c.x2, c.y2),
              x: rx(c.x, c.y),
              y: ry(c.x, c.y),
            };
          case SVGPathData.QUAD_TO:
            return {
              ...c,
              x1: rx(c.x1, c.y1),
              y1: ry(c.x1, c.y1),
              x: rx(c.x, c.y),
              y: ry(c.x, c.y),
            };
          case SVGPathData.SMOOTH_QUAD_TO:
            return { ...c, x: rx(c.x, c.y), y: ry(c.x, c.y) };
          case SVGPathData.ARC:
            return {
              ...c,
              // radii and flags are unchanged by a rotation; the x-axis
              // rotation only matters for elliptical arcs.
              xRot: c.rX === c.rY ? c.xRot : (c.xRot + 90) % 360,
              x: rx(c.x, c.y),
              y: ry(c.x, c.y),
            };
          default:
            return c;
        }
      },
    );
    data.children.push({
      name: "path",
      type: "element",
      children: [],
      value: "",
      attributes: {
        d: new SVGPathData(commands).encode(),
      },
    });
  }
  return optimize(stringify(data));
};

export const rotate = memoize(_rotate);
