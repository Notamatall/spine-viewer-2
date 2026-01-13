import { useEffect, useRef, useState } from "react";
import {
  Application,
  Assets,
  Graphics,
  Rectangle,
  TextureSource,
} from "pixi.js";
import { Spine } from "@esotericsoftware/spine-pixi-v8";
import "./App.css";

type LoadedAssets = {
  keys: string[];
  urls: string[];
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

const gridRows = 5;
const gridCols = 5;
const gridCellGap = 3;
const gridCellRadius = 8;

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

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const singleSpineRef = useRef<Spine | null>(null);
  const singleOutlineRef = useRef<Graphics | null>(null);
  const lastAssetsRef = useRef<LoadedAssets | null>(null);
  const gridFileInputRef = useRef<HTMLInputElement | null>(null);
  const gridSpinesRef = useRef<Map<string, Spine>>(new Map());
  const gridAssetsRef = useRef<Map<string, LoadedAssets>>(new Map());
  const gridOutlinesRef = useRef<Map<string, Graphics>>(new Map());
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
    const cellSize = gridCellSize;
    const gridSize = cellSize * gridCols;
    const gridLeft = app.renderer.width / 2 - gridSize / 2;
    const gridTop = app.renderer.height / 2 - gridSize / 2;
    return { cellSize, gridSize, gridLeft, gridTop };
  };

  const [viewMode, setViewMode] = useState<"single" | "grid">("single");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [atlasFile, setAtlasFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [gridJsonFile, setGridJsonFile] = useState<File | null>(null);
  const [gridAtlasFile, setGridAtlasFile] = useState<File | null>(null);
  const [gridImageFiles, setGridImageFiles] = useState<File[]>([]);
  const [scale, setScale] = useState(1);
  const [animations, setAnimations] = useState<string[]>([]);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [skins, setSkins] = useState<string[]>([]);
  const [selectedSkin, setSelectedSkin] = useState("");
  const [isLooping, setIsLooping] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [gridScale, setGridScale] = useState(1);
  const [multiScale, setMultiScale] = useState(true);
  const [gridCellSize, setGridCellSize] = useState(120);
  const [showGridOutlines, setShowGridOutlines] = useState(true);
  const [gridSlots, setGridSlots] = useState<GridSlot[]>(() =>
    Array.from({ length: gridRows * gridCols }, (_, index) => {
      const row = Math.floor(index / gridCols);
      const col = index % gridCols;
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
    })
  );
  const [activeSlotId, setActiveSlotId] = useState("slot-0-0");
  const [status, setStatus] = useState("Drop files to get started.");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const gridSlotsRef = useRef<GridSlot[]>(gridSlots);
  const lastSingleSignatureRef = useRef("");
  const lastGridSignatureRef = useRef("");

  useEffect(() => {
    gridSlotsRef.current = gridSlots;
  }, [gridSlots]);

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
    drawGridHover(null, null);
  }, [gridCellSize]);

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
    const { cellSize, gridLeft, gridTop } = metrics;

    gridSpinesRef.current.forEach((spine, slotId) => {
      const slot = gridSlotsRef.current.find((item) => item.id === slotId);
      if (!slot) {
        return;
      }
      const x = gridLeft + slot.col * cellSize + cellSize / 2;
      const y = gridTop + slot.row * cellSize + cellSize / 2;
      spine.position.set(x, y);
    });
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
    const { cellSize, gridSize, gridLeft, gridTop } = metrics;
    const cellDrawSize = Math.max(cellSize - gridCellGap, 0);
    const cellOffset = (cellSize - cellDrawSize) / 2;
    guide.clear();
    for (let row = 0; row < gridRows; row += 1) {
      for (let col = 0; col < gridCols; col += 1) {
        const x = gridLeft + col * cellSize + cellOffset;
        const y = gridTop + row * cellSize + cellOffset;
        guide
          .roundRect(
            x + 2,
            y + 4,
            cellDrawSize,
            cellDrawSize,
            gridCellRadius
          )
          .fill({ color: 0x15121c, alpha: 0.55 });
        guide
          .roundRect(x, y, cellDrawSize, cellDrawSize, gridCellRadius)
          .fill({ color: 0x2a2233, alpha: 1 });
      }
    }
    guide
      .rect(gridLeft, gridTop, gridSize, gridSize)
      .stroke({ width: 1, color: 0x2f241e, alpha: 0.35 });
    guide.hitArea = new Rectangle(gridLeft, gridTop, gridSize, gridSize);
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
    const { cellSize, gridLeft, gridTop } = metrics;
    const cellDrawSize = Math.max(cellSize - gridCellGap, 0);
    const cellOffset = (cellSize - cellDrawSize) / 2;
    const x = gridLeft + col * cellSize + cellOffset;
    const y = gridTop + row * cellSize + cellOffset;
    hover
      .roundRect(x, y, cellDrawSize, cellDrawSize, gridCellRadius)
      .fill({ color: 0xff7a4a, alpha: 0.12 })
      .stroke({ width: 1, color: 0xff7a4a, alpha: 0.35 });
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
          const { gridLeft, gridTop, gridSize, cellSize } = metrics;
          const { x, y } = event.global;
          if (
            x < gridLeft ||
            y < gridTop ||
            x > gridLeft + gridSize ||
            y > gridTop + gridSize
          ) {
            return;
          }
          const col = Math.floor((x - gridLeft) / cellSize);
          const row = Math.floor((y - gridTop) / cellSize);
          const slotId = `slot-${row}-${col}`;
          setActiveSlotId(slotId);
        });
      }
      if (!gridHoverRef.current) {
        gridHoverRef.current = new Graphics();
        gridHoverRef.current.zIndex = 2;
      }
      drawGridGuide();
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
          event.clientY
        );
        const { gridLeft, gridTop, gridSize, cellSize } = metrics;
        if (
          point.x < gridLeft ||
          point.y < gridTop ||
          point.x > gridLeft + gridSize ||
          point.y > gridTop + gridSize
        ) {
          return;
        }
        const col = Math.floor((point.x - gridLeft) / cellSize);
        const row = Math.floor((point.y - gridTop) / cellSize);
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
          event.clientY
        );
        const { gridLeft, gridTop, gridSize, cellSize } = metrics;
        if (
          point.x < gridLeft ||
          point.y < gridTop ||
          point.x > gridLeft + gridSize ||
          point.y > gridTop + gridSize
        ) {
          drawGridHover(null, null);
          return;
        }
        const col = Math.floor((point.x - gridLeft) / cellSize);
        const row = Math.floor((point.y - gridTop) / cellSize);
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
        }
      };

      app.ticker.add(() => {
        if (viewModeRef.current === "single") {
          if (singleSpineRef.current && singleOutlineRef.current) {
            updateBoundsOutline(
              singleSpineRef.current,
              singleOutlineRef.current
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
    if (!spine || !selectedAnimation) {
      return;
    }
    spine.state.setAnimation(0, selectedAnimation, isLooping);
  }, [selectedAnimation, isLooping]);

  useEffect(() => {
    const spine = singleSpineRef.current;
    if (!spine || !selectedSkin) {
      return;
    }
    spine.skeleton.setSkinByName(selectedSkin);
    spine.skeleton.setSlotsToSetupPose();
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
    updater: (slot: GridSlot) => GridSlot
  ) => {
    setGridSlots((prev) =>
      prev.map((slot) => (slot.id === slotId ? updater(slot) : slot))
    );
  };

  const getActiveSlot = () =>
    gridSlots.find((slot) => slot.id === activeSlotId) ?? null;

  const createSpineFromFiles = async (
    files: { json: File; atlas: File; images: File[] },
    assetPrefix: string
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
      await Promise.all(
        pageNames.map(async (name) => {
          const file = imageMap.get(name);
          if (!file) {
            return;
          }
          const bitmap = await createImageBitmap(file);
          images[name] = TextureSource.from(bitmap);
        })
      );
      imagesMetadata = images;
    }

    const urlsToRevoke: string[] = [];
    const jsonUrl = URL.createObjectURL(files.json);
    const atlasUrl = URL.createObjectURL(files.atlas);
    urlsToRevoke.push(jsonUrl, atlasUrl);

    const assetId = `${assetPrefix}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const skeletonKey = `spine-skeleton-${assetId}`;
    const atlasKey = `spine-atlas-${assetId}`;

    try {
      Assets.add({ alias: skeletonKey, src: jsonUrl, loadParser: "json" });
      Assets.add({
        alias: atlasKey,
        src: atlasUrl,
        loadParser: "spineTextureAtlasLoader",
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
          (animation) => animation.name
        ),
      };
    } catch (loadError) {
      urlsToRevoke.forEach((url) => URL.revokeObjectURL(url));
      throw loadError;
    }
  };

  const parseSelectedFiles = (files: FileList | null) => {
    if (!files) {
      return { json: null, atlas: null, images: [] as File[] };
    }
    let json: File | null = null;
    let atlas: File | null = null;
    const images: File[] = [];
    Array.from(files).forEach((file) => {
      const name = file.name.toLowerCase();
      if (name.endsWith(".json") && !json) {
        json = file;
      } else if (name.endsWith(".atlas") && !atlas) {
        atlas = file;
      } else if (name.endsWith(".png")) {
        images.push(file);
      }
    });
    return { json, atlas, images };
  };

  const handleSingleLoad = async () => {
    if (!jsonFile || !atlasFile || imageFiles.length === 0) {
      setError("Select the .json, .atlas, and at least one .png file.");
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
        { json: jsonFile, atlas: atlasFile, images: imageFiles },
        "single"
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
        (skin) => skin.name
      );
      setAnimations(animationNames);
      setSkins(skinNames);
      const initialAnimation = animationNames[0] || "";
      setSelectedAnimation(initialAnimation);
      const initialSkin = skinNames[0] || "";
      setSelectedSkin(initialSkin);
      if (initialSkin) {
        result.spine.skeleton.setSkinByName(initialSkin);
        result.spine.skeleton.setSlotsToSetupPose();
      }
      if (initialAnimation) {
        result.spine.state.setAnimation(0, initialAnimation, isLooping);
      }
      result.spine.state.timeScale = isPlaying ? 1 : 0;

      lastAssetsRef.current = result.assets;
      setStatus("Spine loaded. Ready to animate.");
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
    files: { json: File; atlas: File; images: File[] },
    scaleOverride?: number
  ) => {
    const slotSnapshot = gridSlotsRef.current.find(
      (slot) => slot.id === slotId
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
        (skin) => skin.name
      );
      const initialAnimation = animationNames[0] || "";
      const initialSkin = skinNames[0] || "";
      if (initialSkin) {
        result.spine.skeleton.setSkinByName(initialSkin);
        result.spine.skeleton.setSlotsToSetupPose();
      }
      if (initialAnimation) {
        result.spine.state.setAnimation(
          0,
          initialAnimation,
          slotSnapshot.isLooping
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
    if (!gridJsonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      updateGridSlot(activeSlot.id, (slot) => ({
        ...slot,
        error: "Select the .json, .atlas, and at least one .png file.",
      }));
      return;
    }

    setIsLoading(true);
    const slotScale = multiScale ? gridScale : activeSlot.scale;
    await loadGridSlot(
      activeSlot.id,
      {
        json: gridJsonFile,
        atlas: gridAtlasFile,
        images: gridImageFiles,
      },
      slotScale
    );
    setIsLoading(false);
  };

  const handleGridFillEmpty = async () => {
    if (!gridJsonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      if (activeSlotId) {
        updateGridSlot(activeSlotId, (slot) => ({
          ...slot,
          error: "Select the .json, .atlas, and at least one .png file.",
        }));
      }
      return;
    }
    const fillScale = multiScale ? gridScale : activeSlot?.scale ?? 1;
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
          json: gridJsonFile,
          atlas: gridAtlasFile,
          images: gridImageFiles,
        },
        fillScale
      );
    }
    setIsLoading(false);
  };

  const handleGridClear = async () => {
    const slotIds = Array.from(gridSpinesRef.current.keys());
    if (slotIds.length === 0) {
      return;
    }
    setIsLoading(true);
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
    lastGridSignatureRef.current = "";
    setGridJsonFile(null);
    setGridAtlasFile(null);
    setGridImageFiles([]);
    if (gridFileInputRef.current) {
      gridFileInputRef.current.value = "";
    }
    syncStageForMode();
    setIsLoading(false);
  };

  useEffect(() => {
    if (viewMode !== "single" || isLoading) {
      return;
    }
    if (!jsonFile || !atlasFile || imageFiles.length === 0) {
      return;
    }
    const signature = [
      jsonFile.name,
      jsonFile.lastModified,
      atlasFile.name,
      atlasFile.lastModified,
      ...imageFiles.map(
        (file) => `${file.name}-${file.lastModified}-${file.size}`
      ),
    ].join("|");
    if (signature === lastSingleSignatureRef.current) {
      return;
    }
    lastSingleSignatureRef.current = signature;
    handleSingleLoad();
  }, [viewMode, isLoading, jsonFile, atlasFile, imageFiles]);

  useEffect(() => {
    if (viewMode !== "grid" || isLoading) {
      return;
    }
    if (!gridJsonFile || !gridAtlasFile || gridImageFiles.length === 0) {
      return;
    }
    const signature = [
      activeSlotId,
      gridJsonFile.name,
      gridJsonFile.lastModified,
      gridAtlasFile.name,
      gridAtlasFile.lastModified,
      ...gridImageFiles.map(
        (file) => `${file.name}-${file.lastModified}-${file.size}`
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
    gridJsonFile,
    gridAtlasFile,
    gridImageFiles,
  ]);

  const activeSlot = getActiveSlot();
  const activeStatus =
    viewMode === "single"
      ? status
      : activeSlot?.status ?? "Select a slot to load.";
  const activeError = viewMode === "single" ? error : activeSlot?.error ?? null;

  return (
    <div className="app">
      <aside className="panel">
        <div className="panel-header">
          <p className="eyebrow">Spine Viewer</p>
          <h1>Realtime rig preview</h1>
          <p className="subtitle">
            Load a Spine JSON, atlas, and PNG pages to preview the skeleton,
            scale it live, and play any available animation.
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
                <span>Quick Load (JSON + Atlas + PNGs)</span>
                <input
                  type="file"
                  accept=".json,.atlas,.png"
                  multiple
                  onChange={(event) => {
                    const parsed = parseSelectedFiles(event.target.files);
                    setJsonFile(parsed.json);
                    setAtlasFile(parsed.atlas);
                    setImageFiles(parsed.images);
                  }}
                />
                <em>
                  {jsonFile || atlasFile || imageFiles.length > 0
                    ? [
                        jsonFile?.name,
                        atlasFile?.name,
                        ...imageFiles.map((file) => file.name),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Pick JSON, atlas, and PNG pages together"}
                </em>
              </label>
              <p className="hint">
                PNG filenames must match the atlas page names.
              </p>
            </>
          ) : (
            <>
              <label className="field">
                <span>Quick Load (JSON + Atlas + PNGs)</span>
                <input
                  type="file"
                  accept=".json,.atlas,.png"
                  multiple
                  ref={gridFileInputRef}
                  onChange={(event) => {
                    const parsed = parseSelectedFiles(event.target.files);
                    setGridJsonFile(parsed.json);
                    setGridAtlasFile(parsed.atlas);
                    setGridImageFiles(parsed.images);
                  }}
                />
                <em>
                  {gridJsonFile || gridAtlasFile || gridImageFiles.length > 0
                    ? [
                        gridJsonFile?.name,
                        gridAtlasFile?.name,
                        ...gridImageFiles.map((file) => file.name),
                      ]
                        .filter(Boolean)
                        .join(", ")
                    : "Pick JSON, atlas, and PNG pages together"}
                </em>
              </label>
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
                PNG filenames must match the atlas page names.
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
                  : activeSlot?.scale ?? 1
              }
              onChange={(event) => {
                const nextScale = Number(event.target.value);
                if (viewMode === "single") {
                  setScale(nextScale);
                } else {
                  if (multiScale) {
                    setGridScale(nextScale);
                    setGridSlots((prev) =>
                      prev.map((slot) => ({ ...slot, scale: nextScale }))
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
                  : activeSlot?.scale ?? 1
              }
              onChange={(event) => {
                const nextScale = Number(event.target.value || 1);
                if (viewMode === "single") {
                  setScale(nextScale);
                } else {
                  if (multiScale) {
                    setGridScale(nextScale);
                    setGridSlots((prev) =>
                      prev.map((slot) => ({ ...slot, scale: nextScale }))
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
              <span>Cell size</span>
              <div className="scale-controls">
                <input
                  type="range"
                  min={60}
                  max={240}
                  step={5}
                  value={gridCellSize}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value);
                    setGridCellSize(nextSize);
                  }}
                />
                <input
                  type="number"
                  min={40}
                  max={400}
                  step={1}
                  value={gridCellSize}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value || 120);
                    setGridCellSize(nextSize);
                  }}
                />
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
                  : activeSlot?.selectedAnimation ?? ""
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
                      activeSlot.isLooping
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
                : activeSlot?.animations ?? []
              ).length === 0 ? (
                <option value="">No animations</option>
              ) : (
                (viewMode === "single"
                  ? animations
                  : activeSlot?.animations ?? []
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="field">
            <span>Skin</span>
            <select
              value={
                viewMode === "single"
                  ? selectedSkin
                  : activeSlot?.selectedSkin ?? ""
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
                    spine.skeleton.setSkinByName(nextSkin);
                    spine.skeleton.setSlotsToSetupPose();
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
              {(viewMode === "single" ? skins : activeSlot?.skins ?? [])
                .length === 0 ? (
                <option value="">No skins</option>
              ) : (
                (viewMode === "single" ? skins : activeSlot?.skins ?? []).map(
                  (name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  )
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
                  ? animations.length === 0
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
                    : activeSlot?.isLooping ?? true
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
                        nextLoop
                      );
                    }
                  }
                }}
              />
              Loop
            </label>
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
    </div>
  );
}

export default App;
