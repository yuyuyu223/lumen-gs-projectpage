(function () {
  const STORY_SELECTOR = "[data-video-story]";
  const SEQUENCE_SELECTOR = "[data-video-sequence]";
  const TRACK_SELECTOR = "[data-story-track]";
  const VIDEO_SELECTOR = "[data-story-video]";
  const PANEL_SELECTOR = ".story-panel";
  const NAV_SELECTOR = "[data-story-nav]";
  const TRANSITION_DURATION_MS = 900;

  const isVisible = (element) => window.getComputedStyle(element).display !== "none";

  const playVideo = (video) => {
    const playback = video.play();

    if (playback && typeof playback.catch === "function") {
      playback.catch(() => {});
    }
  };

  const resetVideo = (video) => {
    video.pause();

    try {
      video.currentTime = 0;
    } catch (error) {
      // Ignore seek failures before metadata is ready.
    }
  };

  const createSequenceController = (sequenceElement) => {
    const track = sequenceElement.querySelector(TRACK_SELECTOR);

    if (!track) {
      return null;
    }

    const slides = Array.from(track.querySelectorAll(PANEL_SELECTOR))
      .map((panel) => {
        const video = panel.querySelector(VIDEO_SELECTOR);

        if (!video) {
          return null;
        }

        return { panel, video };
      })
      .filter(Boolean);

    const panels = slides.map(({ panel }) => panel);
    const videos = slides.map(({ video }) => video);

    if (!videos.length) {
      return null;
    }

    const changeListeners = new Set();
    let currentIndex = 0;
    let transitionTimer = null;

    const getPublicIndex = () => currentIndex;

    const notifyChange = () => {
      const state = {
        count: videos.length,
        index: getPublicIndex(),
      };

      changeListeners.forEach((listener) => listener(state));
    };

    const clearTimers = () => {
      window.clearTimeout(transitionTimer);
    };

    const pauseHiddenVideos = (visibleIndexes = []) => {
      allVideos.forEach((video, index) => {
        if (!visibleIndexes.includes(index)) {
          video.pause();
        }
      });
    };

    const syncPanelState = (nextIndex, outgoingIndex = null) => {
      panels.forEach((panel, index) => {
        const isActive = index === nextIndex;
        const isOutgoing = outgoingIndex !== null && index === outgoingIndex && outgoingIndex !== nextIndex;

        panel.classList.toggle("is-active", isActive);
        panel.classList.toggle("is-outgoing", isOutgoing);
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
      });
    };

    const playCurrentVideo = () => {
      const currentVideo = videos[getPublicIndex()];

      if (!currentVideo) {
        return;
      }

      playVideo(currentVideo);
    };

    const finishTransition = (outgoingIndex) => {
      sequenceElement.classList.remove("is-transitioning");

      if (outgoingIndex !== null && outgoingIndex !== currentIndex && panels[outgoingIndex]) {
        panels[outgoingIndex].classList.remove("is-outgoing");
      }

      pauseHiddenVideos([currentIndex]);
    };

    const scheduleTransitionCleanup = (outgoingIndex) => {
      transitionTimer = window.setTimeout(() => {
        finishTransition(outgoingIndex);
      }, TRANSITION_DURATION_MS);
    };

    const activateVideo = (nextIndex) => {
      if (nextIndex < 0 || nextIndex >= videos.length) {
        return;
      }

      clearTimers();
      const previousIndex = currentIndex;
      currentIndex = nextIndex;

      if (previousIndex === currentIndex) {
        sequenceElement.classList.remove("is-transitioning");
        syncPanelState(currentIndex);
        pauseHiddenVideos([currentIndex]);
        resetVideo(videos[currentIndex]);
        notifyChange();
        playCurrentVideo();
        return;
      }

      sequenceElement.classList.add("is-transitioning");
      syncPanelState(currentIndex, previousIndex);
      pauseHiddenVideos([previousIndex, currentIndex]);
      videos[previousIndex].pause();
      resetVideo(videos[currentIndex]);
      notifyChange();
      playCurrentVideo();
      scheduleTransitionCleanup(previousIndex);
    };

    const allVideos = videos;

    allVideos.forEach((video) => {
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.preload = "auto";
    });

    if (videos.length === 1) {
      videos[0].loop = true;
    }

    videos.forEach((video, index) => {
      if (videos.length === 1) {
        return;
      }

      video.addEventListener("ended", () => {
        if (index !== currentIndex) {
          return;
        }

        activateVideo((currentIndex + 1) % videos.length);
      });
    });

    syncPanelState(currentIndex);
    notifyChange();

    return {
      getCurrentIndex() {
        return getPublicIndex();
      },
      getVideoCount() {
        return videos.length;
      },
      goTo(index) {
        if (index < 0 || index >= videos.length) {
          return;
        }

        if (index === getPublicIndex()) {
          clearTimers();
          sequenceElement.classList.remove("is-transitioning");
          currentIndex = index;
          syncPanelState(currentIndex);
          pauseHiddenVideos([currentIndex]);
          notifyChange();
          resetVideo(videos[index]);
          playCurrentVideo();
          return;
        }

        activateVideo(index);
      },
      isVisible() {
        return isVisible(sequenceElement);
      },
      onChange(listener) {
        changeListeners.add(listener);
        listener({
          count: videos.length,
          index: getPublicIndex(),
        });

        return () => {
          changeListeners.delete(listener);
        };
      },
      reset() {
        currentIndex = 0;
        sequenceElement.classList.remove("is-transitioning");
        clearTimers();
        allVideos.forEach(resetVideo);
        syncPanelState(currentIndex);
        notifyChange();
      },
      start() {
        syncPanelState(currentIndex);
        playCurrentVideo();
        notifyChange();
      },
    };
  };

  const initVideoStory = () => {
    const storySection = document.querySelector(STORY_SELECTOR);

    if (!storySection) {
      return;
    }

    const controllers = Array.from(storySection.querySelectorAll(SEQUENCE_SELECTOR))
      .map(createSequenceController)
      .filter(Boolean);

    if (!controllers.length) {
      return;
    }

    let nav = storySection.querySelector(NAV_SELECTOR);
    let activeController = null;
    let navButtons = [];
    let unsubscribeNav = null;

    if (!nav) {
      nav = document.createElement("div");
      nav.className = "story-nav";
      nav.setAttribute("data-story-nav", "");
      nav.setAttribute("aria-label", "Video navigation");
      storySection.appendChild(nav);
    }

    const getActiveController = () => controllers.find((controller) => controller.isVisible()) || controllers[0];

    const updateNavState = (activeIndex) => {
      navButtons.forEach((button, index) => {
        const isActive = index === activeIndex;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };

    const buildNav = (controller) => {
      const count = controller.getVideoCount();

      nav.hidden = count <= 1;
      nav.innerHTML = "";
      navButtons = [];

      for (let index = 0; index < count; index += 1) {
        const button = document.createElement("button");
        button.className = "story-nav-button";
        button.type = "button";
        button.setAttribute("aria-label", "Go to video " + (index + 1));
        button.setAttribute("aria-pressed", "false");

        button.addEventListener("click", () => {
          const currentController = getActiveController();

          if (!currentController) {
            return;
          }

          if (activeController !== currentController || navButtons.length !== currentController.getVideoCount()) {
            connectNav(currentController);
          }

          currentController.goTo(index);
        });

        nav.appendChild(button);
        navButtons.push(button);
      }

      updateNavState(controller.getCurrentIndex());
    };

    const connectNav = (controller) => {
      if (unsubscribeNav) {
        unsubscribeNav();
      }

      activeController = controller;
      buildNav(controller);
      unsubscribeNav = controller.onChange(({ index }) => {
        updateNavState(index);
      });
    };

    const syncPlayback = () => {
      const visibleController = getActiveController();

      controllers.forEach((controller) => {
        if (controller !== visibleController) {
          controller.reset();
        }
      });

      if (activeController !== visibleController || navButtons.length !== visibleController.getVideoCount()) {
        connectNav(visibleController);
      } else {
        updateNavState(visibleController.getCurrentIndex());
      }

      visibleController.start();
    };

    window.addEventListener("resize", syncPlayback);
    window.addEventListener("load", syncPlayback, { once: true });

    syncPlayback();
  };

  const initScrollReveal = () => {
    const revealItems = Array.from(document.querySelectorAll("[data-scroll-reveal]"));

    if (!revealItems.length) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.35 }
    );

    revealItems.forEach((item) => observer.observe(item));
  };

  const initTrajectoryRigs = () => {
    const rigs = Array.from(document.querySelectorAll(".ego-rig"));
    const svgNamespace = "http://www.w3.org/2000/svg";

    rigs.forEach((rig) => {
      if (rig.querySelector(".ego-body")) {
        return;
      }

      const frustumGroup = document.createElementNS(svgNamespace, "g");

      for (let index = 0; index < 6; index += 1) {
        const angle = index * 60;
        const frustum = document.createElementNS(svgNamespace, "polygon");
        frustum.classList.add("ego-frustum");
        frustum.setAttribute("points", "0,-5 38,-17 38,17");
        frustum.setAttribute("transform", "rotate(" + angle + ")");
        frustumGroup.appendChild(frustum);
      }

      const body = document.createElementNS(svgNamespace, "rect");
      body.classList.add("ego-body");
      body.setAttribute("x", "-10");
      body.setAttribute("y", "-7");
      body.setAttribute("width", "20");
      body.setAttribute("height", "14");
      body.setAttribute("rx", "3");

      const direction = document.createElementNS(svgNamespace, "path");
      direction.classList.add("ego-direction");
      direction.setAttribute("d", "M0 -4 L9 0 L0 4 Z");

      rig.appendChild(frustumGroup);
      rig.appendChild(body);
      rig.appendChild(direction);
    });
  };

  const initImageComparisons = () => {
    const comparisons = Array.from(document.querySelectorAll("[data-image-comparison]"));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cycleDuration = 5200;

    comparisons.forEach((comparison) => {
      const range = comparison.querySelector(".comparison-range");
      const referenceImage = comparison.querySelector(".comparison-image");

      if (!range) {
        return;
      }

      const updateAspectRatio = () => {
        if (!referenceImage || !referenceImage.naturalWidth || !referenceImage.naturalHeight) {
          return;
        }

        comparison.style.setProperty(
          "--comparison-aspect",
          referenceImage.naturalWidth + " / " + referenceImage.naturalHeight
        );
      };

      const updatePosition = () => {
        comparison.style.setProperty("--comparison-position", range.value + "%");
      };

      if (referenceImage) {
        if (referenceImage.complete) {
          updateAspectRatio();
        } else {
          referenceImage.addEventListener("load", updateAspectRatio, { once: true });
        }
      }

      range.addEventListener("input", updatePosition);
      range.addEventListener("change", updatePosition);
      updatePosition();

      if (reduceMotion) {
        return;
      }

      const animate = (timestamp) => {
        const phase = (timestamp % cycleDuration) / cycleDuration;
        const position = 50 - Math.cos(phase * Math.PI * 2) * 50;

        range.value = position.toFixed(2);
        updatePosition();
        window.requestAnimationFrame(animate);
      };

      window.requestAnimationFrame(animate);
    });
  };

  const initNvsComparison = () => {
    const comparison = document.querySelector("[data-nvs-comparison]");

    if (!comparison) {
      return;
    }

    const buttons = Array.from(comparison.querySelectorAll("[data-nvs-mode]"));
    const comparisonGroups = Array.from(comparison.querySelectorAll(".nvs-display-grid"))
      .map((group) => {
        const videoComparison = group.querySelector("[data-video-comparison]");
        const range = group.querySelector(".comparison-range");
        const rgbVideo = group.querySelector("[data-nvs-rgb]");
        const modalVideo = group.querySelector("[data-nvs-modal]");
        const modalLabel = group.querySelector("[data-nvs-mode-label]");
        const source = modalVideo ? modalVideo.querySelector("source") : null;

        if (!videoComparison || !range || !rgbVideo || !modalVideo || !modalLabel || !source) {
          return null;
        }

        return {
          group,
          videoComparison,
          range,
          rgbVideo,
          modalVideo,
          modalLabel,
          source,
        };
      })
      .filter(Boolean);

    if (!buttons.length || !comparisonGroups.length) {
      return;
    }

    const modeLabels = {
      albedo: "Albedo",
      depth: "Depth",
      mask: "Mask",
      normal: "Normal",
      roughness: "Roughness",
      sunvis: "Sun Visibility",
    };

    const getScenePrefix = (rgbVideo) => {
      const source = rgbVideo.querySelector("source");
      const currentSrc = source ? source.getAttribute("src") || "" : "";
      const match = currentSrc.match(/(.*)_rgb\.mp4$/);

      return match ? match[1] : "./static/videos/nvs/output_0_0_scene";
    };

    const setupGroup = (groupState) => {
      const { group, videoComparison, range, rgbVideo, modalVideo } = groupState;

      groupState.scenePrefix = getScenePrefix(rgbVideo);

      groupState.updatePosition = () => {
        videoComparison.style.setProperty("--comparison-position", range.value + "%");
      };

      groupState.updateAspectRatio = () => {
        if (!rgbVideo.videoWidth || !rgbVideo.videoHeight) {
          return;
        }

        const aspectRatioValue = rgbVideo.videoWidth + " / " + rgbVideo.videoHeight;

        group.style.setProperty("--comparison-aspect", aspectRatioValue);
        videoComparison.style.setProperty("--comparison-aspect", aspectRatioValue);
      };

      groupState.syncPlayback = () => {
        try {
          if (Number.isFinite(rgbVideo.currentTime)) {
            modalVideo.currentTime = rgbVideo.currentTime;
          }
        } catch (error) {
          // Ignore seek failures while the replacement source is still loading.
        }

        playVideo(rgbVideo);
        playVideo(modalVideo);
      };

      range.addEventListener("input", groupState.updatePosition);
      range.addEventListener("change", groupState.updatePosition);

      if (rgbVideo.readyState >= 1) {
        groupState.updateAspectRatio();
      } else {
        rgbVideo.addEventListener("loadedmetadata", groupState.updateAspectRatio, { once: true });
      }

      rgbVideo.addEventListener("play", () => playVideo(modalVideo));
      rgbVideo.addEventListener("pause", () => modalVideo.pause());
      rgbVideo.addEventListener("seeking", groupState.syncPlayback);
      rgbVideo.addEventListener("ratechange", () => {
        modalVideo.playbackRate = rgbVideo.playbackRate;
      });

      groupState.updatePosition();
    };

    const setMode = (mode) => {
      const label = modeLabels[mode] || mode;

      buttons.forEach((button) => {
        const isActive = button.dataset.nvsMode === mode;

        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      comparisonGroups.forEach((groupState) => {
        const nextSrc = groupState.scenePrefix + "_" + mode + ".mp4";

        groupState.modalLabel.textContent = label;

        if (groupState.source.getAttribute("src") === nextSrc) {
          groupState.syncPlayback();
          return;
        }

        groupState.source.setAttribute("src", nextSrc);
        groupState.modalVideo.addEventListener("loadedmetadata", groupState.syncPlayback, { once: true });
        groupState.modalVideo.load();
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        setMode(button.dataset.nvsMode);
      });
    });

    comparisonGroups.forEach(setupGroup);
    setMode(buttons[0].dataset.nvsMode);
  };

  const initPage = () => {
    initVideoStory();
    initTrajectoryRigs();
    initImageComparisons();
    initNvsComparison();
    initScrollReveal();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPage, { once: true });
    return;
  }

  initPage();
})();
