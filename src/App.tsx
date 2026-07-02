import { useEffect, useRef, useState } from "react";
import {
  Application,
  Assets,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  TextureSource,
} from "pixi.js";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import "./App.css";

type LoadedAssets = {
  keys: string[];
  urls: string[];
};

type SpineSourceFiles = {
  skeleton: File;
  atlas: File;
  images: File[];
};

type ParsedSelectedFiles = {
  skeleton: File | null;
  skeletons: File[];
  atlas: File | null;
  images: File[];
};

type GridSlot = {
  id: string;
  label: string;
  row: number;
  col: number;
  hasSpine: boolean;
  animations: string[];
  selectedAnimation: string;
  skins: string[];
  selectedSkin: string;
  isLooping: boolean;
  isPlaying: boolean;
  scale: number;
  status: string;
  error: string | null;
};

type Theme = "light" | "dark";

const defaultGridRows = 5;
const defaultGridCols = 5;
const minGridSize = 4;
const gridCellRadius = 8;
const skeletonInputAccept = ".json,.skel,.atlas,.png,.webp";
const fileSelectionError =
  "Select a skeleton (.json or .skel), a .atlas, and at least one image file (.png or .webp).";
const quickLoadEmptyState =
  "Pick one or more skeletons (.json or .skel), an atlas, and image pages together";
const themeStorageKey = "spine-viewer-theme";

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "light";
  }
  const storedTheme = window.localStorage.getItem(themeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const isSkeletonFileName = (name: string) =>
  name.endsWith(".json") || name.endsWith(".skel");

const isAtlasImageFileName = (name: string) =>
  name.endsWith(".png") || name.endsWith(".webp");

const getSkeletonLoadParser = (file: File) =>
  file.name.toLowerCase().endsWith(".skel") ? "spineSkeletonLoader" : "json";

const compareFilesByName = (a: File, b: File) => a.name.localeCompare(b.name);

const getFileToken = (file: File) =>
  `${file.name}-${file.lastModified}-${file.size}`;

const extractAtlasPageNames = (atlasText: string) => {
  const lines = atlasText.split(/\r?\n/);
  const names: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.includes(":")) {
      continue;
    }
    let nextLine = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (candidate) {
        nextLine = candidate;
        break;
      }
    }
    if (nextLine.startsWith("size:")) {
      names.push(line);
    }
  }
  return names;
};

const createGridSlots = (rows: number, cols: number): GridSlot[] =>
  Array.from({ length: rows * cols }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      id: `slot-${row}-${col}`,
      label: `R${row + 1}C${col + 1}`,
      row,
      col,
      hasSpine: false,
      animations: [],
      selectedAnimation: "",
      skins: [],
      selectedSkin: "",
      isLooping: true,
      isPlaying: true,
      scale: 1,
      status: "Empty slot.",
      error: null,
    };
  });

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const singleSpineRef = useRef<Spine | null>(null);
  const singleOutlineRef = useRef<Graphics | null>(null);
  const lastAssetsRef = useRef<LoadedAssets | null>(null);
  const gridFileInputRef = useRef<HTMLInputElement | null>(null);
  const boardFileInputRef = useRef<HTMLInputElement | null>(null);
  const gridSpinesRef = useRef<Map<string, Spine>>(new Map());
  const gridAssetsRef = useRef<Map<string, LoadedAssets>>(new Map());
  const gridOutlinesRef = useRef<Map<string, Graphics>>(new Map());
  const boardSpineRef = useRef<Spine | null>(null);
  const boardAssetsRef = useRef<LoadedAssets | null>(null);
  const gridGuideRef = useRef<Graphics | null>(null);
  const gridHoverRef = useRef<Graphics | null>(null);
  const assetsReadyRef = useRef(false);
  const viewModeRef = useRef<"single" | "grid">("single");
  const showGridOutlinesRef = useRef(true);

  const getGridMetrics = () => {
    const app = appRef.current;
    if (!app) {
      return null;
    }
    const cellWidth = gridCellWidth * gridBoardScale;
    const cellHeight = gridCellHeight * gridBoardScale;
    const gapX = gridCellGapX * gridBoardScale;
    const gapY = gridCellGapY * gridBoardScale;
    const cellStepX = cellWidth + gapX;
    const cellStepY = cellHeight + gapY;
    const gridWidth = cellWidth * gridCols + gapX * (gridCols - 1);
    const gridHeight = cellHeight * gridRows + gapY * (gridRows - 1);
    const gridLeft = app.renderer.width / 2 - gridWidth / 2;
    const gridTop = app.renderer.height / 2 - gridHeight / 2;
    return {
      cellWidth,
      cellHeight,
      gapX,
      gapY,
      cellStepX,
      cellStepY,
      gridWidth,
      gridHeight,
      gridLeft,
      gridTop,
    };
  };

  const [viewMode, setViewMode] = useState<"single" | "grid">("single");
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [singleSkeletonFiles, setSingleSkeletonFiles] = useState<File[]>([]);
  const [skeletonFile, setSkeletonFile] = useState<File | null>(null);
  const [atlasFile, setAtlasFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [gridSkeletonFiles, setGridSkeletonFiles] = useState<File[]>([]);
  const [gridSkeletonFile, setGridSkeletonFile] = useState<File | null>(null);
  const [gridAtlasFile, setGridAtlasFile] = useState<File | null>(null);
  const [gridImageFiles, setGridImageFiles] = useState<File[]>([]);
  const [boardSkeletonFiles, setBoardSkeletonFiles] = useState<File[]>([]);
  const [boardSkeletonFile, setBoardSkeletonFile] = useState<File | null>(null);
  const [boardAtlasFile, setBoardAtlasFile] = useState<File | null>(null);
  const [boardImageFiles, setBoardImageFiles] = useState<File[]>([]);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [isBoardLoaded, setIsBoardLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [animations, setAnimations] = useState<string[]>([]);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [skins, setSkins] = useState<string[]>([]);
  const [selectedSkin, setSelectedSkin] = useState("");
  const [isLooping, setIsLooping] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [gridRows, setGridRows] = useState(defaultGridRows);
  const [gridCols, setGridCols] = useState(defaultGridCols);
  const [gridScale, setGridScale] = useState(1);
  const [gridBoardScale, setGridBoardScale] = useState(1);
  const [multiScale, setMultiScale] = useState(true);
  const [gridCellWidth, setGridCellWidth] = useState(120);
  const [gridCellHeight, setGridCellHeight] = useState(120);
  const [gridCellGapX, setGridCellGapX] = useState(3);
  const [gridCellGapY, setGridCellGapY] = useState(3);
  const [showGridOutlines, setShowGridOutlines] = useState(true);
  const [showSlotModal, setShowSlotModal] = useState(false);
  const [slotNameInput, setSlotNameInput] = useState("");
  const [slotImageFile, setSlotImageFile] = useState<File | null>(null);
  const [slotImageError, setSlotImageError] = useState<string | null>(null);
  const [gridSlots, setGridSlots] = useState<GridSlot[]>(() =>
    createGridSlots(gridRows, gridCols),
  );
  const [activeSlotId, setActiveSlotId] = useState("slot-0-0");
  const [status, setStatus] = useState("Drop files to get started.");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const themeRef = useRef<Theme>(theme);
  const gridSlotsRef = useRef<GridSlot[]>(gridSlots);
  const lastSingleSignatureRef = useRef("");
  const lastGridSignatureRef = useRef("");
  const lastBoardSignatureRef = useRef("");

  useEffect(() => {
    gridSlotsRef.current = gridSlots;
  }, [gridSlots]);

  useEffect(() => {
    themeRef.current = theme;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    if (viewModeRef.current === "grid") {
      drawGridGuide();
    }
  }, [theme]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    showGridOutlinesRef.current = showGridOutlines;
    if (!showGridOutlines) {
      gridOutlinesRef.current.forEach((outline) => outline.clear());
    } else {
      gridSpinesRef.current.forEach((_, slotId) => {
        ensureGridOutline(slotId);
      });
    }
    if (viewModeRef.current === "grid") {
      syncStageForMode();
    }
  }, [showGridOutlines]);

  useEffect(() => {
    if (viewModeRef.current !== "grid") {
      return;
    }
    drawGridGuide();
    layoutGridSpines();
    layoutGridBoard();
    drawGridHover(null, null);
  }, [
    gridCellWidth,
    gridCellHeight,
    gridCellGapX,
    gridCellGapY,
    gridBoardScale,
    gridRows,
    gridCols,
  ]);

  const clearGridResources = async ({
    resetFiles = true,
    updateSlots = true,
    setLoading = true,
  }: {
    resetFiles?: boolean;
    updateSlots?: boolean;
    setLoading?: boolean;
  } = {}) => {
    const slotIds = new Set<string>([
      ...gridSpinesRef.current.keys(),
      ...gridAssetsRef.current.keys(),
      ...gridOutlinesRef.current.keys(),
    ]);
    if (slotIds.size === 0 && !resetFiles && !updateSlots) {
      return;
    }
    if (setLoading) {
      setIsLoading(true);
    }
    for (const slotId of slotIds) {
      const assets = gridAssetsRef.current.get(slotId);
      if (assets) {
        await Assets.unload(assets.keys);
        assets.urls.forEach((url) => URL.revokeObjectURL(url));
        gridAssetsRef.current.delete(slotId);
      }
      const spine = gridSpinesRef.current.get(slotId);
      if (spine) {
        spine.destroy({ children: true, texture: true, textureSource: true });
        gridSpinesRef.current.delete(slotId);
      }
      const outline = gridOutlinesRef.current.get(slotId);
      if (outline) {
        outline.destroy();
        gridOutlinesRef.current.delete(slotId);
      }
      if (updateSlots) {
        updateGridSlot(slotId, (slot) => ({
          ...slot,
          hasSpine: false,
          animations: [],
          selectedAnimation: "",
          skins: [],
          selectedSkin: "",
          status: "Empty slot.",
          error: null,
        }));
      }
    }
    lastGridSignatureRef.current = "";
    if (resetFiles) {
      setGridSkeletonFiles([]);
      setGridSkeletonFile(null);
      setGridAtlasFile(null);
      setGridImageFiles([]);
      if (gridFileInputRef.current) {
        gridFileInputRef.current.value = "";
      }
    }
    syncStageForMode();
    if (setLoading) {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setGridSlots(createGridSlots(gridRows, gridCols));
    setActiveSlotId("slot-0-0");
    void clearGridResources({
      resetFiles: false,
      updateSlots: false,
      setLoading: false,
    });
  }, [gridRows, gridCols]);

  const centerSingleSpine = (spine: Spine) => {
    const app = appRef.current;
    const container = containerRef.current;
    if (!app || !container) {
      return;
    }
    const bounds = spine.getLocalBounds();
    spine.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    spine.position.set(app.renderer.width / 2, app.renderer.height / 2);
  };

  const updateBoundsOutline = (spine: Spine, outline: Graphics) => {
    const bounds = spine.getBounds();
    outline.clear();
    outline
      .rect(bounds.x, bounds.y, bounds.width, bounds.height)
      .stroke({ width: 1, color: 0xff6b6b, alpha: 0.85 });
  };

  const ensureSingleOutline = () => {
    const app = appRef.current;
    if (!app || singleOutlineRef.current) {
      return;
    }
    const outline = new Graphics();
    outline.zIndex = 10;
    singleOutlineRef.current = outline;
    app.stage.addChild(outline);
  };

  const ensureGridOutline = (slotId: string) => {
    const app = appRef.current;
    if (!app || !showGridOutlinesRef.current) {
      return;
    }
    const existing = gridOutlinesRef.current.get(slotId);
    if (existing) {
      return;
    }
    const outline = new Graphics();
    outline.zIndex = 10;
    gridOutlinesRef.current.set(slotId, outline);
    app.stage.addChild(outline);
  };

  const disableGridOutlines = () => {
    if (!showGridOutlinesRef.current) {
      return;
    }
    showGridOutlinesRef.current = false;
    gridOutlinesRef.current.forEach((outline) => outline.clear());
  };

  const getGridGuidePalette = () =>
    themeRef.current === "dark"
      ? {
          shadowColor: 0x0b0f14,
          shadowAlpha: 0.55,
          fillColor: 0x16212a,
          fillAlpha: 0.95,
          strokeColor: 0x77d1be,
          strokeAlpha: 0.22,
          hoverColor: 0xff8e63,
          hoverFillAlpha: 0.18,
          hoverStrokeAlpha: 0.55,
        }
      : {
          shadowColor: 0x15121c,
          shadowAlpha: 0.55,
          fillColor: 0x2a2233,
          fillAlpha: 1,
          strokeColor: 0x2f241e,
          strokeAlpha: 0.35,
          hoverColor: 0xff7a4a,
          hoverFillAlpha: 0.12,
          hoverStrokeAlpha: 0.35,
        };

  const layoutGridSpines = () => {
    const app = appRef.current;
    const container = containerRef.current;
    if (!app || !container) {
      return;
    }
    const metrics = getGridMetrics();
    if (!metrics) {
      return;
    }
    const { cellWidth, cellHeight, cellStepX, cellStepY, gridLeft, gridTop } =
      metrics;

    gridSpinesRef.current.forEach((spine, slotId) => {
      const slot = gridSlotsRef.current.find((item) => item.id === slotId);
      if (!slot) {
        return;
      }
      const x = gridLeft + slot.col * cellStepX + cellWidth / 2;
      const y = gridTop + slot.row * cellStepY + cellHeight / 2;
      spine.position.set(x, y);
    });
  };

  const layoutGridBoard = () => {
    const spine = boardSpineRef.current;
    if (!spine) {
      return;
    }
    const metrics = getGridMetrics();
    if (!metrics) {
      return;
    }
    const bounds = spine.getLocalBounds();
    spine.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    spine.position.set(
      metrics.gridLeft + metrics.gridWidth / 2,
      metrics.gridTop + metrics.gridHeight / 2,
    );
    spine.scale.set(gridBoardScale);
  };

  const drawGridGuide = () => {
    const app = appRef.current;
    const guide = gridGuideRef.current;
    if (!app || !guide) {
      return;
    }
    const metrics = getGridMetrics();
    if (!metrics) {
      return;
    }
    const {
      cellWidth,
      cellHeight,
      cellStepX,
      cellStepY,
      gridWidth,
      gridHeight,
      gridLeft,
      gridTop,
    } = metrics;
    const cellDrawWidth = cellWidth;
    const cellDrawHeight = cellHeight;
    const cellOffset = 0;
    const palette = getGridGuidePalette();
    guide.clear();
    for (let row = 0; row < gridRows; row += 1) {
      for (let col = 0; col < gridCols; col += 1) {
        const x = gridLeft + col * cellStepX + cellOffset;
        const y = gridTop + row * cellStepY + cellOffset;
        guide
          .roundRect(
            x + 2,
            y + 4,
            cellDrawWidth,
            cellDrawHeight,
            gridCellRadius,
          )
          .fill({ color: palette.shadowColor, alpha: palette.shadowAlpha });
        guide
          .roundRect(x, y, cellDrawWidth, cellDrawHeight, gridCellRadius)
          .fill({ color: palette.fillColor, alpha: palette.fillAlpha });
      }
    }
    guide.rect(gridLeft, gridTop, gridWidth, gridHeight).stroke({
      width: 1,
      color: palette.strokeColor,
      alpha: palette.strokeAlpha,
    });
    guide.hitArea = new Rectangle(gridLeft, gridTop, gridWidth, gridHeight);
  };

  const drawGridHover = (row: number | null, col: number | null) => {
    const app = appRef.current;
    const hover = gridHoverRef.current;
    if (!app || !hover) {
      return;
    }
    hover.clear();
    if (row === null || col === null) {
      return;
    }
    const metrics = getGridMetrics();
    if (!metrics) {
      return;
    }
    const { cellWidth, cellHeight, cellStepX, cellStepY, gridLeft, gridTop } =
      metrics;
    const cellDrawWidth = cellWidth;
    const cellDrawHeight = cellHeight;
    const cellOffset = 0;
    const palette = getGridGuidePalette();
    const x = gridLeft + col * cellStepX + cellOffset;
    const y = gridTop + row * cellStepY + cellOffset;
    hover
      .roundRect(x, y, cellDrawWidth, cellDrawHeight, gridCellRadius)
      .fill({ color: palette.hoverColor, alpha: palette.hoverFillAlpha })
      .stroke({
        width: 1,
        color: palette.hoverColor,
        alpha: palette.hoverStrokeAlpha,
      });
  };

  const setGridLoopingForAll = (nextLoop: boolean) => {
    setGridSlots((prev) =>
      prev.map((slot) => ({
        ...slot,
        isLooping: nextLoop,
      })),
    );
    gridSpinesRef.current.forEach((spine, slotId) => {
      const slot = gridSlotsRef.current.find((item) => item.id === slotId);
      if (slot?.selectedAnimation) {
        spine.state.setAnimation(0, slot.selectedAnimation, nextLoop);
      }
    });
  };

  const syncStageForMode = () => {
    const app = appRef.current;
    if (!app) {
      return;
    }
    app.stage.removeChildren();
    if (viewModeRef.current === "single") {
      if (singleSpineRef.current) {
        app.stage.addChild(singleSpineRef.current);
        centerSingleSpine(singleSpineRef.current);
        ensureSingleOutline();
        if (singleOutlineRef.current) {
          app.stage.addChild(singleOutlineRef.current);
        }
      }
    } else {
      if (!gridGuideRef.current) {
        gridGuideRef.current = new Graphics();
        gridGuideRef.current.zIndex = 0;
        gridGuideRef.current.eventMode = "static";
        gridGuideRef.current.cursor = "pointer";
        gridGuideRef.current.on("pointerdown", (event) => {
          if (viewModeRef.current !== "grid") {
            return;
          }
          disableGridOutlines();
          const metrics = getGridMetrics();
          if (!metrics) {
            return;
          }
          const {
            gridLeft,
            gridTop,
            gridWidth,
            gridHeight,
            cellWidth,
            cellHeight,
            cellStepX,
            cellStepY,
          } = metrics;
          const { x, y } = event.global;
          if (
            x < gridLeft ||
            y < gridTop ||
            x > gridLeft + gridWidth ||
            y > gridTop + gridHeight
          ) {
            return;
          }
          const localX = x - gridLeft;
          const localY = y - gridTop;
          const col = Math.floor(localX / cellStepX);
          const row = Math.floor(localY / cellStepY);
          const withinX = localX - col * cellStepX;
          const withinY = localY - row * cellStepY;
          if (withinX > cellWidth || withinY > cellHeight) {
            return;
          }
          const slotId = `slot-${row}-${col}`;
          setActiveSlotId(slotId);
        });
      }
      if (!gridHoverRef.current) {
        gridHoverRef.current = new Graphics();
        gridHoverRef.current.zIndex = 2;
      }
      drawGridGuide();
      if (boardSpineRef.current) {
        boardSpineRef.current.zIndex = -1;
        app.stage.addChild(boardSpineRef.current);
      }
      app.stage.addChild(gridGuideRef.current);
      app.stage.addChild(gridHoverRef.current);
      gridSpinesRef.current.forEach((spine) => {
        app.stage.addChild(spine);
      });
      if (showGridOutlinesRef.current) {
        gridOutlinesRef.current.forEach((outline) => {
          app.stage.addChild(outline);
        });
      }
      layoutGridSpines();
      layoutGridBoard();
    }
  };

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    const app = new Application();
    appRef.current = app;

    const setup = async () => {
      await app.init({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (cancelled) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      container.innerHTML = "";
      container.appendChild(app.canvas);
      app.stage.sortableChildren = true;
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      const handleCanvasPointer = (event: PointerEvent) => {
        if (viewModeRef.current !== "grid") {
          return;
        }
        disableGridOutlines();
        const metrics = getGridMetrics();
        if (!metrics) {
          return;
        }
        const point = { x: 0, y: 0 };
        app.renderer.events.mapPositionToPoint(
          point,
          event.clientX,
          event.clientY,
        );
        const {
          gridLeft,
          gridTop,
          gridWidth,
          gridHeight,
          cellWidth,
          cellHeight,
          cellStepX,
          cellStepY,
        } = metrics;
        if (
          point.x < gridLeft ||
          point.y < gridTop ||
          point.x > gridLeft + gridWidth ||
          point.y > gridTop + gridHeight
        ) {
          return;
        }
        const localX = point.x - gridLeft;
        const localY = point.y - gridTop;
        const col = Math.floor(localX / cellStepX);
        const row = Math.floor(localY / cellStepY);
        const withinX = localX - col * cellStepX;
        const withinY = localY - row * cellStepY;
        if (withinX > cellWidth || withinY > cellHeight) {
          return;
        }
        const slotId = `slot-${row}-${col}`;
        setActiveSlotId(slotId);
      };
      const handleCanvasMove = (event: PointerEvent) => {
        if (viewModeRef.current !== "grid") {
          drawGridHover(null, null);
          return;
        }
        const metrics = getGridMetrics();
        if (!metrics) {
          return;
        }
        const point = { x: 0, y: 0 };
        app.renderer.events.mapPositionToPoint(
          point,
          event.clientX,
          event.clientY,
        );
        const {
          gridLeft,
          gridTop,
          gridWidth,
          gridHeight,
          cellWidth,
          cellHeight,
          cellStepX,
          cellStepY,
        } = metrics;
        if (
          point.x < gridLeft ||
          point.y < gridTop ||
          point.x > gridLeft + gridWidth ||
          point.y > gridTop + gridHeight
        ) {
          drawGridHover(null, null);
          return;
        }
        const localX = point.x - gridLeft;
        const localY = point.y - gridTop;
        const col = Math.floor(localX / cellStepX);
        const row = Math.floor(localY / cellStepY);
        const withinX = localX - col * cellStepX;
        const withinY = localY - row * cellStepY;
        if (withinX > cellWidth || withinY > cellHeight) {
          drawGridHover(null, null);
          return;
        }
        drawGridHover(row, col);
      };
      const handleCanvasLeave = () => {
        drawGridHover(null, null);
      };
      app.canvas.addEventListener("pointerdown", handleCanvasPointer);
      app.canvas.addEventListener("pointermove", handleCanvasMove);
      app.canvas.addEventListener("pointerleave", handleCanvasLeave);

      const resize = () => {
        if (!container) {
          return;
        }
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        app.renderer.resize(width, height);
        if (viewModeRef.current === "single" && singleSpineRef.current) {
          centerSingleSpine(singleSpineRef.current);
        } else if (viewModeRef.current === "grid") {
          drawGridGuide();
          layoutGridSpines();
          layoutGridBoard();
        }
      };

      app.ticker.add(() => {
        if (viewModeRef.current === "single") {
          if (singleSpineRef.current && singleOutlineRef.current) {
            updateBoundsOutline(
              singleSpineRef.current,
              singleOutlineRef.current,
            );
          }
        } else {
          if (showGridOutlinesRef.current) {
            gridSpinesRef.current.forEach((spine, slotId) => {
              const outline = gridOutlinesRef.current.get(slotId);
              if (outline) {
                updateBoundsOutline(spine, outline);
              }
            });
          }
        }
      });

      observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
    };

    setup();

    return () => {
      cancelled = true;

      observer?.disconnect();
      if (singleSpineRef.current) {
        singleSpineRef.current.destroy({
          children: true,
          texture: true,
          textureSource: true,
        });
        singleSpineRef.current = null;
      }
      if (singleOutlineRef.current) {
        singleOutlineRef.current.destroy();
        singleOutlineRef.current = null;
      }
      gridSpinesRef.current.forEach((spine) => {
        spine.destroy({ children: true, texture: true, textureSource: true });
      });
      gridSpinesRef.current.clear();
      gridOutlinesRef.current.forEach((outline) => outline.destroy());
      gridOutlinesRef.current.clear();
      if (gridGuideRef.current) {
        gridGuideRef.current.destroy();
        gridGuideRef.current = null;
      }
      if (gridHoverRef.current) {
        gridHoverRef.current.destroy();
        gridHoverRef.current = null;
      }
      if (boardSpineRef.current) {
        boardSpineRef.current.destroy({
          children: true,
          texture: true,
          textureSource: true,
        });
        boardSpineRef.current = null;
      }
      if (app) {
        // app.destroy(true)
      }
    };
  }, []);

  useEffect(() => {
    const spine = singleSpineRef.current;
    if (!spine) {
      return;
    }
    spine.scale.set(scale);
    centerSingleSpine(spine);
  }, [scale]);

  useEffect(() => {
    const spine = singleSpineRef.current;
    if (!spine) {
      return;
    }
    if (!selectedAnimation) {
      spine.state.clearTrack(0);
      spine.skeleton.setupPose();
      centerSingleSpine(spine);
      return;
    }
    spine.state.setAnimation(0, selectedAnimation, isLooping);
    centerSingleSpine(spine);
  }, [selectedAnimation, isLooping]);

  useEffect(() => {
    const spine = singleSpineRef.current;
    if (!spine || !selectedSkin) {
      return;
    }
    spine.skeleton.setSkin(selectedSkin);
    spine.skeleton.setupPoseSlots();
    spine.state.apply(spine.skeleton);
  }, [selectedSkin]);

  useEffect(() => {
    const spine = singleSpineRef.current;
    if (!spine) {
      return;
    }
    spine.state.timeScale = isPlaying ? 1 : 0;
  }, [isPlaying]);

  useEffect(() => {
    syncStageForMode();
  }, [viewMode]);

  const updateGridSlot = (
    slotId: string,
    updater: (slot: GridSlot) => GridSlot,
  ) => {
    setGridSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? updater(slot) : slot)),
    );
  };

  const getActiveSlot = () =>
    gridSlots.find((slot) => slot.id === activeSlotId) ?? null;

  const getActiveSpine = () => {
    if (viewMode === "single") {
      return singleSpineRef.current;
    }
    return gridSpinesRef.current.get(activeSlotId) ?? null;
  };

  const closeSlotModal = () => {
    setShowSlotModal(false);
    setSlotImageError(null);
    setSlotImageFile(null);
  };

  const handleSlotImageInsert = async () => {
    const slotName = slotNameInput.trim();
    if (!slotName || !slotImageFile) {
      setSlotImageError("Enter a slot name and choose an image.");
      return;
    }

    const spine = getActiveSpine();
    if (!spine) {
      setSlotImageError("Load a spine before inserting a slot image.");
      return;
    }

    const slot = spine.skeleton.findSlot(slotName);
    if (!slot) {
      setSlotImageError(`Slot "${slotName}" was not found.`);
      return;
    }

    setSlotImageError(null);

    const bitmap = await createImageBitmap(slotImageFile);
    const textureSource = TextureSource.from(bitmap);
    const texture = Texture.from(textureSource);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);

    const attachment = slot.pose.attachment;
    if (
      attachment &&
      "width" in attachment &&
      "height" in attachment &&
      typeof attachment.width === "number" &&
      typeof attachment.height === "number" &&
      attachment.width > 0 &&
      attachment.height > 0
    ) {
      sprite.width = attachment.width;
      sprite.height = attachment.height;
    }

    const existing = spine.getSlotObject(slotName);
    if (existing) {
      spine.removeSlotObject(slotName);
      existing.destroy({ children: true, texture: true, textureSource: true });
    }

    spine.addSlotObject(slotName, sprite);
    closeSlotModal();
    setSlotNameInput("");
  };

  const createSpineFromFiles = async (
    files: SpineSourceFiles,
    assetPrefix: string,
  ) => {
    if (!assetsReadyRef.current) {
      await Assets.init();
      assetsReadyRef.current = true;
    }

    const atlasText = await files.atlas.text();
    const pageNames = extractAtlasPageNames(atlasText);
    if (pageNames.length === 0) {
      throw new Error("Atlas pages not found. Check the .atlas file.");
    }
    const imageMap = new Map(files.images.map((file) => [file.name, file]));

    let imagesMetadata: Record<string, TextureSource> | TextureSource;
    if (pageNames.length <= 1 && files.images.length === 1) {
      const bitmap = await createImageBitmap(files.images[0]);
      imagesMetadata = TextureSource.from(bitmap);
    } else {
      const missing = pageNames.filter((name) => !imageMap.has(name));
      if (missing.length > 0) {
        throw new Error(`Missing atlas pages: ${missing.join(", ")}`);
      }
      const images: Record<string, TextureSource> = {};
      for (const name of pageNames) {
        const file = imageMap.get(name);
        if (!file) {
          continue;
        }
        const bitmap = await createImageBitmap(file);
        images[name] = TextureSource.from(bitmap);
      }
      imagesMetadata = images;
    }

    const urlsToRevoke: string[] = [];
    const skeletonUrl = URL.createObjectURL(files.skeleton);
    const atlasUrl = URL.createObjectURL(files.atlas);
    urlsToRevoke.push(skeletonUrl, atlasUrl);

    const assetId = `${assetPrefix}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const skeletonKey = `spine-skeleton-${assetId}`;
    const atlasKey = `spine-atlas-${assetId}`;

    try {
      Assets.add({
        alias: skeletonKey,
        src: skeletonUrl,
        parser: getSkeletonLoadParser(files.skeleton),
      });
      Assets.add({
        alias: atlasKey,
        src: atlasUrl,
        parser: "spineTextureAtlasLoader",
        data: { images: imagesMetadata },
      });
      await Assets.load([skeletonKey, atlasKey]);

      const spine = Spine.from({
        skeleton: skeletonKey,
        atlas: atlasKey,
        scale: 1,
      });

      return {
        spine,
        assets: { keys: [skeletonKey, atlasKey], urls: urlsToRevoke },
        animationNames: spine.skeleton.data.animations.map(
          (animation) => animation.name,
        ),
      };
    } catch (loadError) {
      urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
      throw loadError;
    }
  };

  const parseSelectedFiles = (files: FileList | null): ParsedSelectedFiles => {
    if (!files) {
      return {
        skeleton: null,
        skeletons: [],
        atlas: null,
        images: [] as File[],
      };
    }
    const skeletons: File[] = [];
    let atlas: File | null = null;
    const images: File[] = [];
    Array.from(files).forEach((file) => {
      const name = file.name.toLowerCase();
      if (isSkeletonFileName(name)) {
        skeletons.push(file);
      } else if (name.endsWith(".atlas") && !atlas) {
        atlas = file;
      } else if (isAtlasImageFileName(name)) {
        images.push(file);
      }
    });
    skeletons.sort(compareFilesByName);
    return {
      skeleton: skeletons[0] ?? null,
      skeletons,
      atlas,
      images,
    };
  };

  const handleSingleLoad = async () => {
    if (!skeletonFile || !atlasFile || imageFiles.length === 0) {
      setError(fileSelectionError);
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus("Loading assets...");
    setAnimations([]);
    setSelectedAnimation("");
    setSkins([]);
    setSelectedSkin("");

    try {
      if (lastAssetsRef.current) {
        await Assets.unload(lastAssetsRef.current.keys);
        lastAssetsRef.current.urls.forEach((url) => URL.revokeObjectURL(url));
        lastAssetsRef.current = null;
      }

      const result = await createSpineFromFiles(
        { skeleton: skeletonFile, atlas: atlasFile, images: imageFiles },
        "single",
      );

      const app = appRef.current;
      if (!app) {
        throw new Error("Renderer is not ready.");
      }

      if (singleSpineRef.current) {
        singleSpineRef.current.destroy({
          children: true,
          texture: true,
          textureSource: true,
        });
        singleSpineRef.current = null;
      }
      if (singleOutlineRef.current) {
        singleOutlineRef.current.destroy();
        singleOutlineRef.current = null;
      }

      result.spine.scale.set(scale);
      singleSpineRef.current = result.spine;

      ensureSingleOutline();

      const animationNames = result.animationNames;
      const skinNames = result.spine.skeleton.data.skins.map(
        (skin) => skin.name,
      );
      setAnimations(animationNames);
      setSkins(skinNames);
      setSelectedAnimation("");
      const initialSkin = skinNames[0] || "";
      setSelectedSkin(initialSkin);
      if (initialSkin) {
        result.spine.skeleton.setSkin(initialSkin);
        result.spine.skeleton.setupPoseSlots();
      }
      result.spine.state.timeScale = isPlaying ? 1 : 0;

      lastAssetsRef.current = result.assets;
      setStatus(
        animationNames.length > 0
          ? "Spine loaded. Pick an animation to play."
          : "Spine loaded. No animations found.",
      );
      syncStageForMode();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load spine data.";
      setError(message);
      setStatus("Load failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadGridSlot = async (
    slotId: string,
    files: SpineSourceFiles,
    scaleOverride?: number,
  ) => {
    const slotSnapshot = gridSlotsRef.current.find(
      (slot) => slot.id === slotId,
    );
    if (!slotSnapshot) {
      return;
    }
    const slotScale = scaleOverride ?? slotSnapshot.scale;
    updateGridSlot(slotId, (slot) => ({
      ...slot,
      status: "Loading assets...",
      error: null,
      hasSpine: false,
      animations: [],
      selectedAnimation: "",
      skins: [],
      selectedSkin: "",
    }));
    try {
      const existingAssets = gridAssetsRef.current.get(slotId);
      if (existingAssets) {
        await Assets.unload(existingAssets.keys);
        existingAssets.urls.forEach((url) => URL.revokeObjectURL(url));
        gridAssetsRef.current.delete(slotId);
      }

      const existingSpine = gridSpinesRef.current.get(slotId);
      if (existingSpine) {
        existingSpine.destroy({
          children: true,
          texture: true,
          textureSource: true,
        });
        gridSpinesRef.current.delete(slotId);
      }
      const existingOutline = gridOutlinesRef.current.get(slotId);
      if (existingOutline) {
        existingOutline.destroy();
        gridOutlinesRef.current.delete(slotId);
      }
      const result = await createSpineFromFiles(files, slotId);

      result.spine.zIndex = 5;
      result.spine.scale.set(slotScale);
      gridSpinesRef.current.set(slotId, result.spine);
      gridAssetsRef.current.set(slotId, result.assets);
      ensureGridOutline(slotId);

      const animationNames = result.animationNames;
      const skinNames = result.spine.skeleton.data.skins.map(
        (skin) => skin.name,
      );
      const initialAnimation = animationNames[0] || "";
      const initialSkin = skinNames[0] || "";
      if (initialSkin) {
        result.spine.skeleton.setSkin(initialSkin);
        result.spine.skeleton.setupPoseSlots();
      }
      if (initialAnimation) {
        result.spine.state.setAnimation(
          0,
          initialAnimation,
          slotSnapshot.isLooping,
        );
      }
      result.spine.state.timeScale = slotSnapshot.isPlaying ? 1 : 0;

      updateGridSlot(slotId, (slot) => ({
        ...slot,
        scale: slotScale,
        hasSpine: true,
        animations: animationNames,
        selectedAnimation: initialAnimation,
        skins: skinNames,
        selectedSkin: initialSkin,
        status: "Spine loaded.",
      }));
      syncStageForMode();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load spine data.";
      updateGridSlot(slotId, (slot) => ({
        ...slot,
        status: "Load failed.",
        error: message,
        hasSpine: false,
      }));
    }
  };

  const handleGridLoad = async () => {
    const activeSlot = getActiveSlot();
    if (!activeSlot) {
      return;
    }
    if (!gridSkeletonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      updateGridSlot(activeSlot.id, (slot) => ({
        ...slot,
        error: fileSelectionError,
      }));
      return;
    }

    setIsLoading(true);
    const slotScale = multiScale ? gridScale : activeSlot.scale;
    await loadGridSlot(
      activeSlot.id,
      {
        skeleton: gridSkeletonFile,
        atlas: gridAtlasFile,
        images: gridImageFiles,
      },
      slotScale,
    );
    setIsLoading(false);
  };

  const handleGridFillEmpty = async () => {
    if (!gridSkeletonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      if (activeSlotId) {
        updateGridSlot(activeSlotId, (slot) => ({
          ...slot,
          error: fileSelectionError,
        }));
      }
      return;
    }
    const fillScale = multiScale ? gridScale : (activeSlot?.scale ?? 1);
    const emptySlots = gridSlots.filter((slot) => !slot.hasSpine);
    if (emptySlots.length === 0) {
      return;
    }
    setIsLoading(true);
    for (const slot of emptySlots) {
      updateGridSlot(slot.id, (slotState) => ({
        ...slotState,
        scale: fillScale,
      }));
      await loadGridSlot(
        slot.id,
        {
          skeleton: gridSkeletonFile,
          atlas: gridAtlasFile,
          images: gridImageFiles,
        },
        fillScale,
      );
    }
    setIsLoading(false);
  };

  const handleGridClear = async () => {
    const slotIds = Array.from(gridSpinesRef.current.keys());
    if (slotIds.length === 0) {
      return;
    }
    await clearGridResources();
  };

  const handleBoardClear = async () => {
    if (boardAssetsRef.current) {
      await Assets.unload(boardAssetsRef.current.keys);
      boardAssetsRef.current.urls.forEach((url) => URL.revokeObjectURL(url));
      boardAssetsRef.current = null;
    }
    if (boardSpineRef.current) {
      boardSpineRef.current.destroy({
        children: true,
        texture: true,
        textureSource: true,
      });
      boardSpineRef.current = null;
    }
    setBoardSkeletonFiles([]);
    setBoardSkeletonFile(null);
    setBoardAtlasFile(null);
    setBoardImageFiles([]);
    setBoardError(null);
    setIsBoardLoaded(false);
    if (boardFileInputRef.current) {
      boardFileInputRef.current.value = "";
    }
    drawGridGuide();
    syncStageForMode();
  };

  const handleBoardLoad = async () => {
    if (!boardSkeletonFile || !boardAtlasFile || boardImageFiles.length === 0) {
      setBoardError(fileSelectionError);
      return;
    }

    setIsLoading(true);
    setBoardError(null);

    try {
      if (boardAssetsRef.current) {
        await Assets.unload(boardAssetsRef.current.keys);
        boardAssetsRef.current.urls.forEach((url) => URL.revokeObjectURL(url));
        boardAssetsRef.current = null;
      }
      if (boardSpineRef.current) {
        boardSpineRef.current.destroy({
          children: true,
          texture: true,
          textureSource: true,
        });
        boardSpineRef.current = null;
      }

      const result = await createSpineFromFiles(
        {
          skeleton: boardSkeletonFile,
          atlas: boardAtlasFile,
          images: boardImageFiles,
        },
        "board",
      );

      result.spine.zIndex = 1;
      boardSpineRef.current = result.spine;
      boardAssetsRef.current = result.assets;
      layoutGridBoard();
      setIsBoardLoaded(true);
      syncStageForMode();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load gameboard spine.";
      setBoardError(message);
      setIsBoardLoaded(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode !== "single" || isLoading) {
      return;
    }
    if (!skeletonFile || !atlasFile || imageFiles.length === 0) {
      return;
    }
    const signature = [
      skeletonFile.name,
      skeletonFile.lastModified,
      atlasFile.name,
      atlasFile.lastModified,
      ...imageFiles.map(
        (file) => `${file.name}-${file.lastModified}-${file.size}`,
      ),
    ].join("|");
    if (signature === lastSingleSignatureRef.current) {
      return;
    }
    lastSingleSignatureRef.current = signature;
    handleSingleLoad();
  }, [viewMode, isLoading, skeletonFile, atlasFile, imageFiles]);

  useEffect(() => {
    if (viewMode !== "grid" || isLoading) {
      return;
    }
    if (!gridSkeletonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      return;
    }
    const signature = [
      activeSlotId,
      gridSkeletonFile.name,
      gridSkeletonFile.lastModified,
      gridAtlasFile.name,
      gridAtlasFile.lastModified,
      ...gridImageFiles.map(
        (file) => `${file.name}-${file.lastModified}-${file.size}`,
      ),
    ].join("|");
    if (signature === lastGridSignatureRef.current) {
      return;
    }
    lastGridSignatureRef.current = signature;
    handleGridLoad();
  }, [
    viewMode,
    isLoading,
    activeSlotId,
    gridSkeletonFile,
    gridAtlasFile,
    gridImageFiles,
  ]);

  useEffect(() => {
    if (viewMode !== "grid" || isLoading) {
      return;
    }
    if (!boardSkeletonFile || !boardAtlasFile || boardImageFiles.length === 0) {
      return;
    }
    const signature = [
      boardSkeletonFile.name,
      boardSkeletonFile.lastModified,
      boardAtlasFile.name,
      boardAtlasFile.lastModified,
      ...boardImageFiles.map(
        (file) => `${file.name}-${file.lastModified}-${file.size}`,
      ),
    ].join("|");
    if (signature === lastBoardSignatureRef.current) {
      return;
    }
    lastBoardSignatureRef.current = signature;
    handleBoardLoad();
  }, [viewMode, isLoading, boardSkeletonFile, boardAtlasFile, boardImageFiles]);

  const activeSlot = getActiveSlot();
  const activeStatus =
    viewMode === "single"
      ? status
      : (activeSlot?.status ?? "Select a slot to load.");
  const activeError =
    viewMode === "single" ? error : (activeSlot?.error ?? null);

  return (
    <div className="app">
      <aside className="panel">
        <div className="panel-header">
          <div className="panel-header-top">
            <p className="eyebrow">Spine Viewer</p>
            <button
              type="button"
              className="theme-toggle"
              aria-pressed={theme === "dark"}
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              onClick={() =>
                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
              }
            >
              <span className="theme-toggle-label">Dark mode</span>
              <span
                className={`theme-toggle-track ${
                  theme === "dark" ? "active" : ""
                }`}
                aria-hidden="true"
              >
                <span className="theme-toggle-thumb" />
              </span>
            </button>
          </div>
          <h1>Realtime rig preview</h1>
          <p className="subtitle">
            Load a Spine skeleton (.json or .skel), atlas, and image pages to
            preview the skeleton, scale it live, and play any available
            animation.
          </p>
        </div>

        <div className="tab-row">
          <button
            type="button"
            className={`tab ${viewMode === "single" ? "active" : ""}`}
            onClick={() => setViewMode("single")}
          >
            Single
          </button>
          <button
            type="button"
            className={`tab ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
          >
            Grid
          </button>
        </div>

        <div className="panel-section">
          <h2>Files</h2>
          {viewMode === "single" ? (
            <>
              <label className="field">
                <span>Quick Load (JSON/SKEL + Atlas + Images)</span>
                <input
                  type="file"
                  accept={skeletonInputAccept}
                  multiple
                  onChange={(event) => {
                    const parsed = parseSelectedFiles(event.target.files);
                    setSingleSkeletonFiles(parsed.skeletons);
                    setSkeletonFile(parsed.skeleton);
                    setAtlasFile(parsed.atlas);
                    setImageFiles(parsed.images);
                  }}
                />
                <em>
                  {skeletonFile || atlasFile || imageFiles.length > 0
                    ? [
                        skeletonFile?.name,
                        atlasFile?.name,
                        ...imageFiles.map((file) => file.name),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : quickLoadEmptyState}
                </em>
              </label>
              {singleSkeletonFiles.length > 1 ? (
                <label className="field">
                  <span>Skeleton</span>
                  <select
                    value={skeletonFile ? getFileToken(skeletonFile) : ""}
                    onChange={(event) => {
                      setSkeletonFile(
                        singleSkeletonFiles.find(
                          (file) => getFileToken(file) === event.target.value,
                        ) ?? null,
                      );
                    }}
                    disabled={isLoading}
                  >
                    {singleSkeletonFiles.map((file) => (
                      <option
                        key={getFileToken(file)}
                        value={getFileToken(file)}
                      >
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <em>Switch between skeleton files that share this atlas.</em>
                </label>
              ) : null}
              <p className="hint">
                Image filenames must match the atlas page names.
              </p>
              <div className="button-row">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowSlotModal(true)}
                >
                  Insert Slot Image
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Quick Load (JSON/SKEL + Atlas + Images)</span>
                <input
                  type="file"
                  accept={skeletonInputAccept}
                  multiple
                  ref={gridFileInputRef}
                  onChange={(event) => {
                    const parsed = parseSelectedFiles(event.target.files);
                    setGridSkeletonFiles(parsed.skeletons);
                    setGridSkeletonFile(parsed.skeleton);
                    setGridAtlasFile(parsed.atlas);
                    setGridImageFiles(parsed.images);
                  }}
                />
                <em>
                  {gridSkeletonFile ||
                  gridAtlasFile ||
                  gridImageFiles.length > 0
                    ? [
                        gridSkeletonFile?.name,
                        gridAtlasFile?.name,
                        ...gridImageFiles.map((file) => file.name),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : quickLoadEmptyState}
                </em>
              </label>
              {gridSkeletonFiles.length > 1 ? (
                <label className="field">
                  <span>Symbol skeleton</span>
                  <select
                    value={
                      gridSkeletonFile ? getFileToken(gridSkeletonFile) : ""
                    }
                    onChange={(event) => {
                      setGridSkeletonFile(
                        gridSkeletonFiles.find(
                          (file) => getFileToken(file) === event.target.value,
                        ) ?? null,
                      );
                    }}
                    disabled={isLoading}
                  >
                    {gridSkeletonFiles.map((file) => (
                      <option
                        key={getFileToken(file)}
                        value={getFileToken(file)}
                      >
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <em>Choose which symbol skeleton to load into the grid.</em>
                </label>
              ) : null}
              <label className="field">
                <span>Gameboard spine</span>
                <input
                  type="file"
                  accept={skeletonInputAccept}
                  multiple
                  ref={boardFileInputRef}
                  onChange={(event) => {
                    const parsed = parseSelectedFiles(event.target.files);
                    setBoardSkeletonFiles(parsed.skeletons);
                    setBoardSkeletonFile(parsed.skeleton);
                    setBoardAtlasFile(parsed.atlas);
                    setBoardImageFiles(parsed.images);
                  }}
                  style={{ display: "none" }}
                />
                <div className="button-row">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => boardFileInputRef.current?.click()}
                    disabled={isLoading}
                  >
                    {isBoardLoaded
                      ? "Replace gameboard spine"
                      : "Load gameboard spine"}
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={handleBoardClear}
                    disabled={!isBoardLoaded && !boardSkeletonFile}
                  >
                    Clear gameboard
                  </button>
                </div>
                <em>
                  {boardSkeletonFile ||
                  boardAtlasFile ||
                  boardImageFiles.length > 0
                    ? [
                        boardSkeletonFile?.name,
                        boardAtlasFile?.name,
                        ...boardImageFiles.map((file) => file.name),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Load a board spine to replace the grid cells."}
                </em>
                {boardError ? <p className="hint">{boardError}</p> : null}
              </label>
              {boardSkeletonFiles.length > 1 ? (
                <label className="field">
                  <span>Board skeleton</span>
                  <select
                    value={
                      boardSkeletonFile ? getFileToken(boardSkeletonFile) : ""
                    }
                    onChange={(event) => {
                      setBoardSkeletonFile(
                        boardSkeletonFiles.find(
                          (file) => getFileToken(file) === event.target.value,
                        ) ?? null,
                      );
                    }}
                    disabled={isLoading}
                  >
                    {boardSkeletonFiles.map((file) => (
                      <option
                        key={getFileToken(file)}
                        value={getFileToken(file)}
                      >
                        {file.name}
                      </option>
                    ))}
                  </select>
                  <em>Choose which board skeleton to render.</em>
                </label>
              ) : null}
              <label className="field">
                <span>Symbol Slot</span>
                <select
                  value={activeSlotId}
                  onChange={(event) => setActiveSlotId(event.target.value)}
                >
                  {gridSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label} (R{slot.row + 1}C{slot.col + 1})
                    </option>
                  ))}
                </select>
                <em>
                  {activeSlot
                    ? `Editing ${activeSlot.label}`
                    : "Select a slot to edit."}
                </em>
              </label>
              <p className="hint">
                Image filenames must match the atlas page names.
              </p>
              <div className="button-row">
                <button
                  className="ghost"
                  type="button"
                  onClick={handleGridFillEmpty}
                  disabled={isLoading}
                >
                  Fill Empty Slots
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={handleGridClear}
                  disabled={isLoading}
                >
                  Clear Grid
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowGridOutlines((prev) => !prev)}
                >
                  {showGridOutlines ? "Hide outlines" : "Show outlines"}
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowSlotModal(true)}
                >
                  Insert Slot Image
                </button>
              </div>
            </>
          )}
        </div>

        <div className="panel-section">
          <h2>Scale</h2>
          <div className="scale-controls">
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.05}
              value={
                viewMode === "single"
                  ? scale
                  : multiScale
                    ? gridScale
                    : (activeSlot?.scale ?? 1)
              }
              onChange={(event) => {
                const nextScale = Number(event.target.value);
                if (viewMode === "single") {
                  setScale(nextScale);
                } else {
                  if (multiScale) {
                    setGridScale(nextScale);
                    setGridSlots((prev) =>
                      prev.map((slot) => ({ ...slot, scale: nextScale })),
                    );
                    gridSpinesRef.current.forEach((spine) => {
                      spine.scale.set(nextScale);
                    });
                  } else if (activeSlot) {
                    updateGridSlot(activeSlot.id, (slot) => ({
                      ...slot,
                      scale: nextScale,
                    }));
                    const spine = gridSpinesRef.current.get(activeSlot.id);
                    if (spine) {
                      spine.scale.set(nextScale);
                    }
                  }
                  layoutGridSpines();
                }
              }}
            />
            <input
              type="number"
              min={0.1}
              max={5}
              step={0.05}
              value={
                viewMode === "single"
                  ? scale
                  : multiScale
                    ? gridScale
                    : (activeSlot?.scale ?? 1)
              }
              onChange={(event) => {
                const nextScale = Number(event.target.value || 1);
                if (viewMode === "single") {
                  setScale(nextScale);
                } else {
                  if (multiScale) {
                    setGridScale(nextScale);
                    setGridSlots((prev) =>
                      prev.map((slot) => ({ ...slot, scale: nextScale })),
                    );
                    gridSpinesRef.current.forEach((spine) => {
                      spine.scale.set(nextScale);
                    });
                  } else if (activeSlot) {
                    updateGridSlot(activeSlot.id, (slot) => ({
                      ...slot,
                      scale: nextScale,
                    }));
                    const spine = gridSpinesRef.current.get(activeSlot.id);
                    if (spine) {
                      spine.scale.set(nextScale);
                    }
                  }
                  layoutGridSpines();
                }
              }}
            />
          </div>
          {viewMode === "grid" ? (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={multiScale}
                onChange={(event) => setMultiScale(event.target.checked)}
              />
              Scale all symbols
            </label>
          ) : null}
        </div>

        {viewMode === "grid" ? (
          <div className="panel-section">
            <h2>Grid</h2>
            <label className="field">
              <span>Grid size</span>
              <div className="grid-size-controls stack">
                <label className="grid-size-field">
                  <span>Rows</span>
                  <input
                    type="number"
                    min={minGridSize}
                    step={1}
                    value={gridRows}
                    onChange={(event) => {
                      const nextRows = Math.max(
                        minGridSize,
                        Math.floor(Number(event.target.value || minGridSize)),
                      );
                      setGridRows(nextRows);
                    }}
                  />
                </label>
                <label className="grid-size-field">
                  <span>Columns</span>
                  <input
                    type="number"
                    min={minGridSize}
                    step={1}
                    value={gridCols}
                    onChange={(event) => {
                      const nextCols = Math.max(
                        minGridSize,
                        Math.floor(Number(event.target.value || minGridSize)),
                      );
                      setGridCols(nextCols);
                    }}
                  />
                </label>
              </div>
            </label>
            <label className="field">
              <span>Board scale</span>
              <div className="scale-controls">
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={gridBoardScale}
                  onChange={(event) => {
                    const nextScale = Number(event.target.value || 1);
                    const clamped = Math.min(2, Math.max(0.5, nextScale));
                    setGridBoardScale(clamped);
                  }}
                />
                <input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={gridBoardScale}
                  onChange={(event) => {
                    const nextScale = Number(event.target.value || 1);
                    const clamped = Math.min(2, Math.max(0.5, nextScale));
                    setGridBoardScale(clamped);
                  }}
                />
              </div>
            </label>
            <label className="field">
              <span>Cell size</span>
              <div className="grid-size-controls stack">
                <label className="grid-size-field">
                  <span>Width</span>
                  <div className="scale-controls stack">
                    <input
                      type="range"
                      min={60}
                      max={240}
                      step={5}
                      value={gridCellWidth}
                      onChange={(event) => {
                        const nextSize = Number(event.target.value);
                        setGridCellWidth(nextSize);
                      }}
                    />
                    <input
                      type="number"
                      min={40}
                      max={400}
                      step={1}
                      value={gridCellWidth}
                      onChange={(event) => {
                        const nextSize = Number(event.target.value || 120);
                        setGridCellWidth(nextSize);
                      }}
                    />
                  </div>
                </label>
                <label className="grid-size-field">
                  <span>Height</span>
                  <div className="scale-controls stack">
                    <input
                      type="range"
                      min={60}
                      max={240}
                      step={5}
                      value={gridCellHeight}
                      onChange={(event) => {
                        const nextSize = Number(event.target.value);
                        setGridCellHeight(nextSize);
                      }}
                    />
                    <input
                      type="number"
                      min={40}
                      max={400}
                      step={1}
                      value={gridCellHeight}
                      onChange={(event) => {
                        const nextSize = Number(event.target.value || 120);
                        setGridCellHeight(nextSize);
                      }}
                    />
                  </div>
                </label>
              </div>
            </label>
            <label className="field">
              <span>Cell gap</span>
              <div className="grid-size-controls stack">
                <label className="grid-size-field">
                  <span>Horizontal</span>
                  <div className="scale-controls stack">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={gridCellGapX}
                      onChange={(event) => {
                        const nextGap = Number(event.target.value || 0);
                        setGridCellGapX(Math.max(0, Math.min(40, nextGap)));
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={80}
                      step={1}
                      value={gridCellGapX}
                      onChange={(event) => {
                        const nextGap = Number(event.target.value || 0);
                        setGridCellGapX(Math.max(0, Math.min(80, nextGap)));
                      }}
                    />
                  </div>
                </label>
                <label className="grid-size-field">
                  <span>Vertical</span>
                  <div className="scale-controls stack">
                    <input
                      type="range"
                      min={0}
                      max={40}
                      step={1}
                      value={gridCellGapY}
                      onChange={(event) => {
                        const nextGap = Number(event.target.value || 0);
                        setGridCellGapY(Math.max(0, Math.min(40, nextGap)));
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={80}
                      step={1}
                      value={gridCellGapY}
                      onChange={(event) => {
                        const nextGap = Number(event.target.value || 0);
                        setGridCellGapY(Math.max(0, Math.min(80, nextGap)));
                      }}
                    />
                  </div>
                </label>
              </div>
            </label>
          </div>
        ) : null}

        <div className="panel-section">
          <h2>Animation</h2>
          <label className="field">
            <span>Clip</span>
            <select
              value={
                viewMode === "single"
                  ? selectedAnimation
                  : (activeSlot?.selectedAnimation ?? "")
              }
              onChange={(event) => {
                const nextAnimation = event.target.value;
                if (viewMode === "single") {
                  setSelectedAnimation(nextAnimation);
                } else if (activeSlot) {
                  updateGridSlot(activeSlot.id, (slot) => ({
                    ...slot,
                    selectedAnimation: nextAnimation,
                  }));
                  const spine = gridSpinesRef.current.get(activeSlot.id);
                  if (spine && nextAnimation) {
                    spine.state.setAnimation(
                      0,
                      nextAnimation,
                      activeSlot.isLooping,
                    );
                  }
                }
              }}
              disabled={
                viewMode === "single"
                  ? animations.length === 0
                  : (activeSlot?.animations.length ?? 0) === 0
              }
            >
              {(viewMode === "single"
                ? animations
                : (activeSlot?.animations ?? [])
              ).length === 0 ? (
                <option value="">No animations</option>
              ) : (
                <>
                  {viewMode === "single" ? (
                    <option value="">No animation</option>
                  ) : null}
                  {(viewMode === "single"
                    ? animations
                    : (activeSlot?.animations ?? [])
                  ).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
          <label className="field">
            <span>Skin</span>
            <select
              value={
                viewMode === "single"
                  ? selectedSkin
                  : (activeSlot?.selectedSkin ?? "")
              }
              onChange={(event) => {
                const nextSkin = event.target.value;
                if (viewMode === "single") {
                  setSelectedSkin(nextSkin);
                } else if (activeSlot) {
                  updateGridSlot(activeSlot.id, (slot) => ({
                    ...slot,
                    selectedSkin: nextSkin,
                  }));
                  const spine = gridSpinesRef.current.get(activeSlot.id);
                  if (spine && nextSkin) {
                    spine.skeleton.setSkin(nextSkin);
                    spine.skeleton.setupPoseSlots();
                    spine.state.apply(spine.skeleton);
                    layoutGridSpines();
                  }
                }
              }}
              disabled={
                viewMode === "single"
                  ? skins.length === 0
                  : (activeSlot?.skins.length ?? 0) === 0
              }
            >
              {(viewMode === "single" ? skins : (activeSlot?.skins ?? []))
                .length === 0 ? (
                <option value="">No skins</option>
              ) : (
                (viewMode === "single" ? skins : (activeSlot?.skins ?? [])).map(
                  (name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ),
                )
              )}
            </select>
          </label>
          <div className="toggle-row">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                if (viewMode === "single") {
                  setIsPlaying((prev) => !prev);
                } else if (activeSlot) {
                  const nextPlaying = !activeSlot.isPlaying;
                  updateGridSlot(activeSlot.id, (slot) => ({
                    ...slot,
                    isPlaying: nextPlaying,
                  }));
                  const spine = gridSpinesRef.current.get(activeSlot.id);
                  if (spine) {
                    spine.state.timeScale = nextPlaying ? 1 : 0;
                  }
                }
              }}
              disabled={
                viewMode === "single"
                  ? animations.length === 0 || !selectedAnimation
                  : (activeSlot?.animations.length ?? 0) === 0
              }
            >
              {viewMode === "single"
                ? isPlaying
                  ? "Pause"
                  : "Play"
                : activeSlot?.isPlaying
                  ? "Pause"
                  : "Play"}
            </button>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={
                  viewMode === "single"
                    ? isLooping
                    : (activeSlot?.isLooping ?? true)
                }
                onChange={(event) => {
                  const nextLoop = event.target.checked;
                  if (viewMode === "single") {
                    setIsLooping(nextLoop);
                  } else if (activeSlot) {
                    updateGridSlot(activeSlot.id, (slot) => ({
                      ...slot,
                      isLooping: nextLoop,
                    }));
                    const spine = gridSpinesRef.current.get(activeSlot.id);
                    if (spine && activeSlot.selectedAnimation) {
                      spine.state.setAnimation(
                        0,
                        activeSlot.selectedAnimation,
                        nextLoop,
                      );
                    }
                  }
                }}
              />
              Loop
            </label>
            {viewMode === "grid" ? (
              <>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setGridLoopingForAll(false)}
                >
                  Disable all loops
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setGridLoopingForAll(true)}
                >
                  Enable all loops
                </button>
              </>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="stage">
        <div className="stage-header">
          <div>
            <p className="eyebrow">Viewport</p>
            <h2>{viewMode === "single" ? "Live preview" : "Grid preview"}</h2>
          </div>
          <div className="status">
            <span>{activeStatus}</span>
            {activeError ? <strong>{activeError}</strong> : null}
          </div>
        </div>
        <div className="canvas-shell">
          <div className="canvas-frame" ref={containerRef} />
          {/* {hasViewportSpine ? null : (
            <div className="empty-state">
              <p>
                {viewMode === "single"
                  ? "Upload files to render the skeleton preview."
                  : "Load slot spines to fill the grid."}
              </p>
            </div>
          )} */}
        </div>
      </main>
      {showSlotModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Slot image</p>
                <h3>Insert image into a slot</h3>
              </div>
              <button className="ghost" type="button" onClick={closeSlotModal}>
                Close
              </button>
            </div>
            <label className="field">
              <span>Slot name</span>
              <input
                type="text"
                placeholder="e.g. head-slot"
                value={slotNameInput}
                onChange={(event) => setSlotNameInput(event.target.value)}
              />
              <em>Use the exact slot name from the Spine skeleton.</em>
            </label>
            <label className="field">
              <span>Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setSlotImageFile(event.target.files?.[0] ?? null)
                }
              />
              <em>PNG/JPEG/WebP all work.</em>
            </label>
            {slotImageError ? (
              <p className="modal-error">{slotImageError}</p>
            ) : null}
            <div className="button-row">
              <button
                className="primary"
                type="button"
                onClick={handleSlotImageInsert}
              >
                Insert image
              </button>
              <button className="ghost" type="button" onClick={closeSlotModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
