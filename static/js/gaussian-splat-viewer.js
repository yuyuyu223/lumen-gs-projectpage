import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";
import * as THREE from "three";

(function () {
  const VIEWER_SELECTOR = "[data-gaussian-splat-viewer]";
  const STAGE_SELECTOR = "[data-splat-stage]";
  const DROP_ZONE_SELECTOR = "[data-splat-drop-zone]";
  const EMPTY_SELECTOR = "[data-splat-empty]";
  const STATUS_SELECTOR = "[data-splat-status]";
  const FILE_INPUT_SELECTOR = "[data-splat-file-input]";
  const SUPPORTED_EXTENSIONS = [".ply", ".splat", ".ksplat", ".spz"];

  const objectUrls = new Set();

  const getFileExtension = (fileName) => {
    const lowerName = fileName.toLowerCase();
    return SUPPORTED_EXTENSIONS.find((extension) => lowerName.endsWith(extension));
  };

  const setStatus = (root, message, state = "") => {
    const status = root.querySelector(STATUS_SELECTOR);

    if (!status) {
      return;
    }

    status.textContent = message;
    status.dataset.state = state;
  };

  const setEmptyState = (root, visible) => {
    const emptyState = root.querySelector(EMPTY_SELECTOR);

    if (emptyState) {
      emptyState.hidden = !visible;
    }

    root.classList.toggle("has-scene", !visible);
  };

  const normalizeDropState = (dropZone) => {
    dropZone.classList.remove("is-dragging");
  };

  const createSceneAutoRotation = (viewer) => {
    if (!viewer.splatMesh) {
      return () => {};
    }

    const splatMesh = viewer.splatMesh;
    const zAxis = new THREE.Vector3(0, 0, 1);
    const spin = new THREE.Quaternion();
    const speedRadiansPerSecond = THREE.MathUtils.degToRad(30);
    let animationFrame = null;
    let lastSortTime = 0;
    let previousTime = performance.now();
    let disposed = false;

    const tick = (time) => {
      if (disposed || viewer.isDisposingOrDisposed?.()) {
        return;
      }

      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.08);
      previousTime = time;
      spin.setFromAxisAngle(zAxis, speedRadiansPerSecond * deltaSeconds);
      splatMesh.quaternion.premultiply(spin).normalize();
      splatMesh.updateMatrixWorld(true);

      if (time - lastSortTime > 80 && !viewer.sortRunning && typeof viewer.runSplatSort === "function") {
        lastSortTime = time;
        viewer.runSplatSort(true, true);
      }

      if (typeof viewer.forceRenderNextFrame === "function") {
        viewer.forceRenderNextFrame();
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  };

  const createFreeOrbitControls = (viewer, stage) => {
    const camera = viewer.camera;
    const target = new THREE.Vector3().fromArray(viewer.initialCameraLookAt?.toArray?.() || [0, 0, 0]);
    const domElement = viewer.renderer.domElement;
    const rotateSpeed = 0.005;
    const minDistance = 0.05;
    const maxDistance = 1000;
    const pointer = {
      active: false,
      button: 0,
      id: null,
      x: 0,
      y: 0,
    };

    const requestRender = () => {
      if (typeof viewer.forceRenderNextFrame === "function") {
        viewer.forceRenderNextFrame();
      }
    };

    const syncCamera = () => {
      camera.lookAt(target);
      requestRender();
    };

    const rotateCamera = (deltaX, deltaY) => {
      const offset = camera.position.clone().sub(target);

      if (offset.lengthSq() === 0) {
        return;
      }

      const yawAxis = camera.up.clone().normalize();
      const yaw = new THREE.Quaternion().setFromAxisAngle(yawAxis, -deltaX * rotateSpeed);
      offset.applyQuaternion(yaw);
      camera.up.applyQuaternion(yaw);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);

      const pitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const pitch = new THREE.Quaternion().setFromAxisAngle(pitchAxis, -deltaY * rotateSpeed);
      offset.copy(camera.position).sub(target).applyQuaternion(pitch);
      camera.up.applyQuaternion(pitch).normalize();
      camera.position.copy(target).add(offset);
      syncCamera();
    };

    const panCamera = (deltaX, deltaY) => {
      const offset = camera.position.clone().sub(target);
      const distance = Math.max(offset.length(), minDistance);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = camera.up.clone().normalize();
      let worldUnitsPerPixel = distance / Math.max(stage.clientHeight, 1);

      if (camera.isPerspectiveCamera) {
        worldUnitsPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / Math.max(stage.clientHeight, 1);
      } else if (camera.isOrthographicCamera) {
        worldUnitsPerPixel = (camera.top - camera.bottom) / Math.max(stage.clientHeight, 1);
      }

      const pan = right.multiplyScalar(-deltaX * worldUnitsPerPixel).add(up.multiplyScalar(deltaY * worldUnitsPerPixel));
      camera.position.add(pan);
      target.add(pan);
      syncCamera();
    };

    const zoomCamera = (deltaY) => {
      const offset = camera.position.clone().sub(target);
      const distance = offset.length();

      if (distance === 0) {
        return;
      }

      const nextDistance = THREE.MathUtils.clamp(distance * Math.exp(deltaY * 0.001), minDistance, maxDistance);
      offset.setLength(nextDistance);
      camera.position.copy(target).add(offset);
      syncCamera();
    };

    const onPointerDown = (event) => {
      if (pointer.active) {
        return;
      }

      event.preventDefault();
      pointer.active = true;
      pointer.button = event.button;
      pointer.id = event.pointerId;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      domElement.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event) => {
      if (!pointer.active || event.pointerId !== pointer.id) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - pointer.x;
      const deltaY = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;

      if (pointer.button === 0) {
        rotateCamera(deltaX, deltaY);
      } else {
        panCamera(deltaX, deltaY);
      }
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== pointer.id) {
        return;
      }

      pointer.active = false;
      pointer.id = null;
      domElement.releasePointerCapture?.(event.pointerId);
    };

    const onWheel = (event) => {
      event.preventDefault();
      zoomCamera(event.deltaY);
    };

    const onContextMenu = (event) => {
      event.preventDefault();
    };

    domElement.addEventListener("pointerdown", onPointerDown);
    domElement.addEventListener("pointermove", onPointerMove);
    domElement.addEventListener("pointerup", onPointerUp);
    domElement.addEventListener("pointercancel", onPointerUp);
    domElement.addEventListener("wheel", onWheel, { passive: false });
    domElement.addEventListener("contextmenu", onContextMenu);
    syncCamera();

    return {
      dispose() {
        domElement.removeEventListener("pointerdown", onPointerDown);
        domElement.removeEventListener("pointermove", onPointerMove);
        domElement.removeEventListener("pointerup", onPointerUp);
        domElement.removeEventListener("pointercancel", onPointerUp);
        domElement.removeEventListener("wheel", onWheel);
        domElement.removeEventListener("contextmenu", onContextMenu);
      },
      setTarget(nextTarget) {
        target.copy(nextTarget);
        syncCamera();
      },
    };
  };

  const setDefaultCameraView = (viewer, controls) => {
    if (!viewer.splatMesh || !viewer.camera) {
      return;
    }

    const bounds = viewer.splatMesh.computeBoundingBox(true);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const diameter = Math.max(size.x, size.y, size.z, 1);
    const distance = diameter * 3;

    viewer.camera.position.set(center.x, center.y - distance, 0);
    viewer.camera.up.set(0, 0, 1);
    viewer.camera.lookAt(center);
    controls?.setTarget(center);

    if (typeof viewer.forceRenderNextFrame === "function") {
      viewer.forceRenderNextFrame();
    }
  };

  const createViewer = (stage) => {
    return new GaussianSplats3D.Viewer({
      rootElement: stage,
      cameraUp: [0, -1, -0.6],
      initialCameraPosition: [0, 1, 4],
      initialCameraLookAt: [0, 0, 0],
      useBuiltInControls: false,
      sphericalHarmonicsDegree: 2,
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
    });
  };

  const disposeViewer = async (viewer) => {
    if (!viewer) {
      return;
    }

    if (typeof viewer.dispose === "function") {
      await viewer.dispose();
      return;
    }

    if (typeof viewer.stop === "function") {
      viewer.stop();
    }
  };

  const buildSceneOptions = (extension) => {
    const options = {
      showLoadingUI: false,
      progressiveLoad: true,
      splatAlphaRemovalThreshold: 5,
    };

    const formatByExtension = {
      ".ply": GaussianSplats3D.SceneFormat.Ply,
      ".splat": GaussianSplats3D.SceneFormat.Splat,
      ".ksplat": GaussianSplats3D.SceneFormat.KSplat,
      ".spz": GaussianSplats3D.SceneFormat.Spz,
    };

    options.format = formatByExtension[extension];

    return options;
  };

  const initSplatViewer = (root) => {
    const stage = root.querySelector(STAGE_SELECTOR);
    const dropZone = root.querySelector(DROP_ZONE_SELECTOR);
    const fileInput = root.querySelector(FILE_INPUT_SELECTOR);

    if (!stage || !dropZone) {
      return;
    }

    let viewer = null;
    let disposeControls = null;
    let disposeAutoRotation = null;

    const loadScene = async (source, label) => {
      const extension = getFileExtension(label || source);

      if (!extension) {
        setStatus(root, "Unsupported file type. Use PLY, SPLAT, KSPLAT, or SPZ.", "error");
        return;
      }

      setEmptyState(root, false);
      setStatus(root, "Loading " + label + "...", "loading");

      disposeAutoRotation?.();
      disposeAutoRotation = null;
      disposeControls?.dispose();
      disposeControls = null;
      await disposeViewer(viewer);
      stage.innerHTML = "";
      viewer = createViewer(stage);
      disposeControls = createFreeOrbitControls(viewer, stage);

      try {
        await viewer.addSplatScene(source, buildSceneOptions(extension));
        setDefaultCameraView(viewer, disposeControls);
        viewer.start();
        disposeAutoRotation = createSceneAutoRotation(viewer);
        setStatus(root, "Loaded " + label, "ready");
      } catch (error) {
        console.error(error);
        disposeAutoRotation?.();
        disposeAutoRotation = null;
        disposeControls?.dispose();
        disposeControls = null;
        await disposeViewer(viewer);
        viewer = null;
        stage.innerHTML = "";
        setEmptyState(root, true);
        setStatus(root, "Could not load " + label + ". Check the file path or format.", "error");
      }
    };

    const loadFile = (file) => {
      if (!file) {
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      objectUrls.add(objectUrl);
      loadScene(objectUrl, file.name);
    };

    fileInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      loadFile(file);
      event.target.value = "";
    });

    dropZone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });

    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });

    dropZone.addEventListener("dragleave", (event) => {
      if (!dropZone.contains(event.relatedTarget)) {
        normalizeDropState(dropZone);
      }
    });

    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      normalizeDropState(dropZone);
      loadFile(event.dataTransfer?.files?.[0]);
    });

    const defaultSource = root.dataset.splatSrc?.trim();

    if (defaultSource) {
      loadScene(defaultSource, defaultSource.split("/").pop() || defaultSource);
      return;
    }

    setEmptyState(root, true);
  };

  const initPage = () => {
    document.querySelectorAll(VIEWER_SELECTOR).forEach(initSplatViewer);
  };

  window.addEventListener("beforeunload", () => {
    objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    objectUrls.clear();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPage, { once: true });
    return;
  }

  initPage();
})();
