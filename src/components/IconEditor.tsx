"use client";
import Editor from "react-simple-code-editor";
import { SvgEditor } from "./SvgEditor";
import { highlight } from "@/lib/highlight";
import { optimize } from "@/lib/optimize";
import React, { useEffect, useRef, useState } from "react";
import { format } from "@/lib/format";
import { Label } from "./ui/label";
import {
  CircleDotIcon,
  CopyIcon,
  Grid2x2Icon,
  RotateCwIcon,
  ScissorsIcon,
  Trash2Icon,
  TypeOutlineIcon,
  WandSparklesIcon,
} from "lucide-react";
import { Button } from "./ui/button";
import { getPaths, getNodes } from "@/lib/get-paths";
import { useQueryState } from "next-usequerystate";
import { useTheme } from "next-themes";
import debounce from "lodash/debounce";
import { useSelection, Selection } from "./providers/SelectionProvider";
import round from "lodash/round";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { toast } from "sonner";
import { cutOut } from "@/lib/cut-out";
import { cut } from "@/lib/cut";
import { useSession } from "next-auth/react";
import { INode, parseSync } from "svgson";
import camelCase from "lodash/camelCase";
import { nodesToSvg } from "@/lib/nodes-to-svg";
import { pathToPathNode } from "@/lib/path-to-path-node";

interface IconEditorProps {
  value: string;
  onChange: (value: string) => void;
}

type PreviewMode = "1" | "2" | "3" | "pixelated" | "rotated";

const PREVIEW_OPTIONS: { value: PreviewMode; label: string; title: string }[] =
  [
    { value: "1", label: "1px", title: "Thin (1px stroke)" },
    { value: "2", label: "2px", title: "Medium (2px stroke, default)" },
    { value: "3", label: "3px", title: "Thick (3px stroke)" },
    {
      value: "pixelated",
      label: "Pixel",
      title: "Pixelated (native 1x raster preview)",
    },
    {
      value: "rotated",
      label: "Rotated",
      title: "Rotated 90° — check how the icon reads at other orientations",
    },
  ];

const toReactProps = (attributes: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(attributes).map(([key, val]) => [
      key === "class"
        ? "className"
        : /^(xmlns|xlink|data-|aria-)/.test(key)
          ? key
          : camelCase(key),
      val,
    ]),
  );

const renderNode = (node: INode, key: number): React.ReactNode =>
  React.createElement(
    node.name,
    { ...toReactProps(node.attributes), key },
    ...(node.children ?? []).map(renderNode),
  );

// Renders the current SVG with its content wrapped in a 90 degree rotation
// about the canvas center. Stays inline SVG (currentColor resolves with the
// theme, no rasterizing). Non-interactive; replaces the editor while active.
const RotatedPreview = ({ value }: { value: string }) => {
  let root: INode | undefined;
  try {
    root = parseSync(value);
  } catch {
    root = undefined;
  }
  if (!root || root.name !== "svg") return null;
  const width = parseFloat(root.attributes.width ?? "24") || 24;
  const height = parseFloat(root.attributes.height ?? "24") || 24;
  const {
    xmlns,
    width: _w,
    height: _h,
    viewBox,
    ...rootAttributes
  } = toReactProps(root.attributes);
  return (
    <div className="flex aspect-square h-full w-full items-center justify-center rounded-md">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rootAttributes}
        viewBox={viewBox ?? `0 0 ${width} ${height}`}
        className="h-full w-full"
      >
        <g transform={`rotate(90 ${width / 2} ${height / 2})`}>
          {(root.children ?? []).map(renderNode)}
        </g>
      </svg>
    </div>
  );
};

// Renders the current SVG rasterized at its native pixel size, then scaled up
// with `image-rendering: pixelated` to approximate how the icon looks on a
// low-DPI (1x) screen. Replaces the interactive editor while active.
const PixelPreview = ({ value }: { value: string }) => {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = parseInt(value.match(/width="(\d+)"/)?.[1] ?? "24");
    const height = parseInt(value.match(/height="(\d+)"/)?.[1] ?? "24");

    // stroke="currentColor" does not resolve when rasterized via an <img>,
    // so substitute the resolved theme foreground color before serializing.
    const color = getComputedStyle(container).color;
    const coloredSvg = value.replaceAll("currentColor", color);

    const blob = new Blob([coloredSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    let cancelled = false;

    image.onload = () => {
      if (cancelled) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
      }
    };
    image.onerror = () => {};
    image.src = url;

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [value, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className="flex aspect-square h-full w-full items-center justify-center rounded-md"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
};

export const IconEditor = ({ value, onChange }: IconEditorProps) => {
  const session = useSession();
  const [, setName] = useQueryState("name");
  const [focus, setFocus] = useState(false);
  const [selected, setSelected] = useSelection();
  const [nextValue, setNextValue] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useQueryState<PreviewMode>("preview", {
    defaultValue: "2",
    parse: (query) =>
      query === "1" ||
      query === "3" ||
      query === "pixelated" ||
      query === "rotated"
        ? query
        : "2",
    serialize: (value) => (value === "2" ? null : value) as string,
  });
  const strokeWidth = preview === "1" ? 1 : preview === "3" ? 3 : 2;
  const isPixelated = preview === "pixelated";
  const isRotated = preview === "rotated";

  const onSelect = debounce((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { selectionStart, selectionEnd } = e.target;

    const highlights = highlight(value);

    const paths = getPaths(value);
    const newSelection: Selection[] = [];
    for (let i = selectionEnd || 0; i >= 0; i--) {
      if (i < selectionStart - 1 && highlights[i].includes("</span>")) {
        break;
      }
      if (highlights[i].includes("icon-editor-highlight")) {
        const matchPath = highlights[i].match(
          /icon-editor-highlight-segment-(\d+)-(\d+)/,
        );

        const path =
          matchPath?.[1] &&
          matchPath?.[2] &&
          paths.find(
            (p) =>
              p.c.id + "" === matchPath[1] && p.c.idx + "" === matchPath[2],
          );

        if (path) {
          newSelection.push({
            ...path,
            startPosition: { x: 0, y: 0 },
            selectionType: "svg-editor-path",
          });
          continue;
        }

        const matchElement = highlights[i].match(/icon-editor-highlight-(\d+)/);

        const element =
          !!matchElement?.[1] &&
          paths.filter((p) => p.c.id + "" === matchElement[1]);

        if (element && element.length) {
          for (const path of element) {
            newSelection.push({
              ...path,
              startPosition: { x: 0, y: 0 },
              selectionType: "svg-editor-path",
            });
          }
        }
      }
    }
    setSelected(newSelection);
  });

  return (
    <div className="flex gap-5 flex-col lg:flex-row">
      <div className="flex flex-col gap-1.5 h-[min-content] w-full lg:w-[480px]">
        <div className="flex items-center justify-between gap-2">
          <Label asChild>
            <span>Preview</span>
          </Label>
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5">
            {PREVIEW_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={preview === option.value ? "secondary" : "ghost"}
                size="sm"
                title={option.title}
                aria-pressed={preview === option.value}
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => setPreview(option.value)}
              >
                {option.value === "pixelated" && (
                  <Grid2x2Icon className="h-3.5 w-3.5" />
                )}
                {option.value === "rotated" && (
                  <RotateCwIcon className="h-3.5 w-3.5" />
                )}
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        {isPixelated ? (
          <PixelPreview value={nextValue || value} />
        ) : isRotated ? (
          <RotatedPreview value={nextValue || value} />
        ) : (
          <ContextMenu>
            <ContextMenuTrigger>
              <SvgEditor
                src={nextValue || value}
                strokeWidth={strokeWidth}
                onChange={(value) => {
                  setNextValue(undefined);
                  onChange(format(value));
                }}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                className="gap-1.5"
                disabled={!selected.length}
                onClick={() => {
                  const height = parseInt(
                    value.match(/height="(\d+)"/)?.[1] ?? "24",
                  );
                  const width = parseInt(
                    value.match(/width="(\d+)"/)?.[1] ?? "24",
                  );
                  const paths = getPaths(value);
                  const nextNodes = getNodes(value).flatMap((node, id) => {
                    if (!selected.some(({ c }) => c.id === id)) {
                      return node;
                    }
                    return paths
                      .filter(
                        (path) =>
                          path.c.id === id &&
                          !selected.some(
                            ({ c }) => c.id === path.c.id && c.idx === path.c.idx,
                          ),
                      )
                      .map(pathToPathNode);
                  });
                  onChange(format(nodesToSvg(nextNodes, height, width)));
                  setSelected([]);
                }}
              >
                <Trash2Icon />
                Delete
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-1.5"
                disabled={!selected.length}
                onClick={() => {
                  const height = parseInt(
                    value.match(/height="(\d+)"/)?.[1] ?? "24",
                  );
                  const width = parseInt(
                    value.match(/width="(\d+)"/)?.[1] ?? "24",
                  );
                  const nextNodes = [
                    ...getNodes(value),
                    ...selected
                      .flatMap((path) => {
                        const n = path.d.split(" ");
                        if (path.cp1) {
                          n[3] = "C" + round(path.cp1.x + 3, 3);
                          n[4] = round(path.cp1.y + 1, 3) + "";
                        }
                        if (path.cp2) {
                          n[5] = round(path.cp2.x + 3, 3) + "";
                          n[6] = round(path.cp2.y + 1, 3) + "";
                        }
                        n[1] = round(path.prev.x + 3, 3) + "";
                        n[2] = round(path.prev.y + 1, 3) + "";
                        n[n.length - 2] = round(path.next.x + 3, 3) + "";
                        n[n.length - 1] = round(path.next.y + 1, 3) + "";
                        return [
                          {
                            ...path,
                            d: n.join(" "),
                          },
                        ];
                      })
                      // @ts-ignore
                      .map(pathToPathNode),
                  ];
                  onChange(format(nodesToSvg(nextNodes, height, width)));
                }}
              >
                <CopyIcon />
                Duplicate
              </ContextMenuItem>
              {selected.length > 0 &&
                selected.every(
                  ({ c, circle }) => circle && c.name !== "circle",
                ) && (
                  <ContextMenuItem
                    className="gap-1.5"
                    onClick={async () => {
                      const height = parseInt(
                        value.match(/height="(\d+)"/)?.[1] ?? "24",
                      );
                      const width = parseInt(
                        value.match(/width="(\d+)"/)?.[1] ?? "24",
                      );
                      onChange(
                        optimize(
                          nodesToSvg(
                            [
                              ...getPaths(value)
                                .filter((path) =>
                                  selected.every(
                                    (s) =>
                                      !(
                                        path.type === "arc" &&
                                        path.circle &&
                                        s.circle &&
                                        Math.abs(path.circle.x - s.circle.x) <
                                          0.01 &&
                                        Math.abs(path.circle.y - s.circle.y) <
                                          0.01 &&
                                        Math.abs(path.circle.r - s.circle.r) <
                                          0.01
                                      ),
                                  ),
                                )
                                .map(pathToPathNode),
                              ...selected.map(
                                ({ circle }) =>
                                  ({
                                    name: "circle",
                                    value: "",
                                    children: [],
                                    type: "element",
                                    attributes: {
                                      cx: circle!.x + "",
                                      cy: circle!.y + "",
                                      r: circle!.r + "",
                                    },
                                  }) as INode,
                              ),
                            ],
                            height,
                            width,
                          ),
                        ),
                      );
                    }}
                  >
                    <CircleDotIcon />
                    Circlify
                  </ContextMenuItem>
                )}
              {JSON.parse(session.data?.user?.image || "{}").role === "admin" && (
                <>
                  <ContextMenuItem
                    className="gap-1.5"
                    disabled={!selected.length}
                    onClick={async () => {
                      // @ts-ignore
                      const promise = cutOut(value, selected);
                      toast.promise(promise, {
                        loading: "Processing SVG...",
                        success: "SVG processed successfully!",
                        error: "An error occurred while processing the SVG.",
                      });
                      onChange(await promise);
                      setSelected([]);
                    }}
                  >
                    <TypeOutlineIcon />
                    Cutout
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="gap-1.5"
                    disabled={!selected.length}
                    onClick={async () => {
                      // @ts-ignore
                      const promise = cut(value, selected);
                      toast.promise(promise, {
                        loading: "Processing SVG...",
                        success: "SVG processed successfully!",
                        error: "An error occurred while processing the SVG.",
                      });
                      onChange(await promise);
                      setSelected([]);
                    }}
                  >
                    <ScissorsIcon />
                    Cut
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )}
        <span className="text-xs text-muted-foreground hidden lg:inline-block">
          Tip:{" "}
          {selected.length
            ? "Shift-click to add or remove segments from the selection."
            : "Shift-click to select the full element."}
        </span>
      </div>
      <div className="relative flex flex-col gap-1.5 w-full">
        <Label htmlFor="source-editor">Source</Label>
        <Editor
          textareaId="source-editor"
          value={nextValue || value}
          onSelect={(_e) => onSelect(_e as any)}
          onClick={(_e) => onSelect(_e as any)}
          onPaste={(e) => {
            if (e.clipboardData.files.length > 0) {
              e.preventDefault();
              if (e.clipboardData.files[0].name) {
                setName(e.clipboardData.files[0].name?.split(".")[0]);
              }
              const reader = new FileReader();
              reader.onload = (e) => {
                const result = e.target?.result;
                if (typeof result === "string") {
                  setNextValue(undefined);
                  onChange(format(result));
                  setSelected([]);
                }
              };
              reader.readAsText(e.clipboardData.files[0]);
            }
            if (
              // @ts-ignore
              e.target.selectionStart === 0 &&
              // @ts-ignore
              e.target.selectionEnd === e.target.value.length
            ) {
              e.preventDefault();
              const clipboardData = e.clipboardData.getData("text/plain");
              const clipboardDataName = clipboardData.match(
                /class="lucide lucide-([\w-]+)/,
              );
              if (clipboardDataName && clipboardDataName[1]) {
                setName(clipboardDataName[1].replace(/-icon$/, ""));
              }
              setNextValue(undefined);
              onChange(format(clipboardData));
              setSelected([]);
            }
          }}
          onValueChange={setNextValue}
          className="h-full min-w-full min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground data-[focus=true]:outline-none data-[focus=true]:ring-2 data-[focus=true]:ring-ring data-[focus=true]:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          data-focus={focus}
          padding={12}
          onFocus={() => {
            setFocus(true);
            setNextValue(undefined);
            onChange(format(nextValue || value));
          }}
          onBlur={() => {
            setFocus(false);
            setNextValue(undefined);
            onChange(format(nextValue || value));
          }}
          highlight={(value) => highlight(value).join("")}
        />
        <div className="absolute flex flex-col z-10 gap-1.5 top-[calc(0.875rem+0.375rem+12px)] right-[12px]">
          <Button
            variant="outline"
            className="gap-1.5"
            onMouseEnter={() => {
              const nextNextValue = optimize(nextValue || value);
              onChange(format(nextValue || value));
              setNextValue(nextNextValue);
            }}
            onMouseLeave={() => setNextValue(undefined)}
            onClick={() => onChange(optimize(value))}
          >
            <WandSparklesIcon />
            Tidy
          </Button>
        </div>
      </div>
      <style>
        {`
  textarea.npm__react-simple-code-editor__textarea:focus { outline: none }
  .svg-preview-bounding-box-label-path:hover { cursor: pointer; user-select: none }
  .svg-preview-backdrop { user-select: none; pointer-events: none }
  .svg-preview-bounding-box-label-path:active { cursor: grabbing }
  .svg-editor-path:hover, .svg-editor-start:hover, .svg-editor-end:hover, .svg-editor-circle:hover, .svg-editor-cp1:hover, .svg-editor-cp2:hover { stroke: black; stroke-opacity: 0.5 }
  .svg-editor-radius:hover { stroke: #fbbf24; stroke-opacity: 1 }
  .svg-editor-path, .svg-editor-start, .svg-editor-end, .svg-editor-circle, .svg-editor-radius, .svg-editor-cp1, .svg-editor-cp2 { cursor: pointer }
  .svg-editor-circle:hover, .svg-editor-path:hover { cursor: move }
  .svg-editor-radius:hover { cursor: crosshair }
  ${selected
    .map(
      ({ c: { id, idx } }) => `
  .icon-editor-highlight-${id},
  .icon-editor-highlight-segment-${id}-${idx} {
    box-shadow: 0 0 0 2px black !important;
  }
  .icon-editor-highlight-${id}:is(.dark *),
  .icon-editor-highlight-segment-${id}-${idx}:is(.dark *) {
    box-shadow: 0 0 0 2px white !important;
  }
  `,
    )
    .join("")}
        `}
      </style>
    </div>
  );
};
