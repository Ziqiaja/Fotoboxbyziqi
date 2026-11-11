    (() => {
      let maxPhotos = 3;
      const frameStyles = {
        pink: { paper: "#fff5f2", accent: "#e88e9f", text: "#76515b" },
        lilac: { paper: "#f6f1fc", accent: "#aa94d1", text: "#5c4c70" },
        film: { paper: "#f4f0e9", accent: "#a89170", text: "#625747" }
      };
      const filters = {
        natural: "none",
        warm: "sepia(0.2) saturate(1.13) brightness(1.03)",
        mono: "grayscale(1)",
        rose: "sepia(0.12) saturate(1.32) hue-rotate(326deg) brightness(1.04)",
        cool: "saturate(0.94) hue-rotate(15deg) contrast(1.04)",
        vintage: "sepia(0.38) saturate(0.82) contrast(0.94) brightness(1.04)"
      };
      const patternColors = {
        pink: "#e88e9f",
        lilac: "#aa94d1",
        film: "#a89170"
      };
      const photos = [];
      let activeFrame = "pink";
      let activeFilter = "natural";
      let activeEffect = "none";
      let activePattern = "hearts";
      let activeSticker = "";
      let activeLayout = "strip";
      let retakeIndex = null;
      let sessionRunning = false;
      let sessionGeneration = 0;
      let captureFinishTimer = null;
      let activeCaptureResolve = null;
      let facingMode = "user";
      let cameraStream = null;
      let countdownTimer = null;
      let capturing = false;
      let handLandmarker = null;
      let gestureEnabled = false;
      let gestureLoading = false;
      let gestureAnimationFrame = 0;
      let lastGestureDetectionAt = 0;
      let lastGestureVideoTime = -1;
      let gestureStableFrames = 0;
      let gestureReleaseFrames = 0;
      let gestureArmed = true;

      const video = document.getElementById("cameraVideo");
      const cameraOverlay = document.getElementById("cameraOverlay");
      const cameraStage = document.getElementById("cameraStage");
      const cameraButton = document.getElementById("cameraButton");
      const flipCameraButton = document.getElementById("flipCameraButton");
      const gestureButton = document.getElementById("gestureButton");
      const gestureButtonLabel = document.getElementById("gestureButtonLabel");
      const gestureStatus = document.getElementById("gestureStatus");
      const effectOverlay = document.getElementById("effectOverlay");
      const captureButton = document.getElementById("captureButton");
      const captureLabel = document.getElementById("captureLabel");
      const uploadInput = document.getElementById("uploadInput");
      const timerSelect = document.getElementById("timerSelect");
      const coupleNames = document.getElementById("coupleNames");
      const coupleCaption = document.getElementById("coupleCaption");
      const cameraError = document.getElementById("cameraError");
      const liveBadge = document.getElementById("liveBadge");
      const countdown = document.getElementById("countdown");
      const shotCount = document.getElementById("shotCount");
      const stripCount = document.getElementById("stripCount");
      const stripCanvas = document.getElementById("stripCanvas");
      const stripPlaceholder = document.getElementById("stripPlaceholder");
      const photoGallery = document.getElementById("photoGallery");
      const photoCountSelect = document.getElementById("photoCountSelect");
      const layoutSelect = document.getElementById("layoutSelect");
      const sessionButton = document.getElementById("sessionButton");
      const sessionButtonLabel = document.getElementById("sessionButtonLabel");
      const sessionStatus = document.getElementById("sessionStatus");
      const downloadButton = document.getElementById("downloadButton");
      const resetButton = document.getElementById("resetButton");

      function showCameraError(message) {
        cameraError.textContent = message;
        cameraError.classList.add("is-visible");
      }

      function clearCameraError() {
        cameraError.textContent = "";
        cameraError.classList.remove("is-visible");
      }

      function setGestureStatus(message, state) {
        gestureStatus.textContent = message;
        gestureStatus.dataset.state = state;
      }

      function setSessionStatus(message, state = "idle") {
        sessionStatus.textContent = message;
        sessionStatus.dataset.state = state;
      }

      function setCameraReady(ready) {
        video.hidden = !ready;
        cameraOverlay.hidden = ready;
        liveBadge.classList.toggle("is-live", ready);
        flipCameraButton.hidden = !ready;
        captureButton.disabled = !ready || (photos.length >= maxPhotos && retakeIndex === null) || capturing || sessionRunning;
        sessionButton.disabled = (!ready && !sessionRunning) || (capturing && !sessionRunning);
        cameraButton.querySelector("span:last-child").textContent = ready ? "Matikan kamera" : "Nyalakan kamera";
        video.style.transform = facingMode === "user" ? "scaleX(-1)" : "none";
      }

      async function toggleCamera() {
        clearCameraError();
        if (cameraStream) {
          if (sessionRunning) {
            sessionRunning = false;
            sessionGeneration += 1;
            cancelActiveCapture();
            setSessionStatus("Kamera dimatikan. Sesi fotobox dihentikan.");
            updatePhotoCount();
          }
          if (gestureEnabled) stopGestureSensor();
          if (capturing) cancelActiveCapture();
          cameraStream.getTracks().forEach((track) => track.stop());
          cameraStream = null;
          setCameraReady(false);
          return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          showCameraError("Browser ini belum mendukung akses kamera. Coba buka lewat HTTPS atau gunakan tombol Pilih foto.");
          return;
        }

        cameraButton.disabled = true;
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: facingMode } }
          });
          video.srcObject = cameraStream;
          await video.play();
          setCameraReady(true);
          applyLiveFilter();
        } catch (error) {
          if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
          cameraStream = null;
          const message = error && error.name === "NotAllowedError"
            ? "Izin kamera belum diberikan. Izinkan akses kamera di browser, atau pilih foto dari perangkat."
            : error && error.name === "NotFoundError"
              ? "Kamera tidak ditemukan. Kamu tetap bisa membuat photostrip dengan memilih foto."
              : "Kamera belum bisa dinyalakan. Pastikan browser memiliki izin kamera, atau pilih foto dari perangkat.";
          showCameraError(message);
        } finally {
          cameraButton.disabled = false;
        }
      }

      async function flipCamera() {
        if (!cameraStream) return;
        const previousFacingMode = facingMode;
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
        facingMode = facingMode === "user" ? "environment" : "user";
        setCameraReady(false);
        await toggleCamera();
        if (!cameraStream) facingMode = previousFacingMode;
      }

      function applyLiveFilter() {
        video.style.filter = filters[activeFilter];
        effectOverlay.dataset.effect = activeEffect;
      }

      function pointDistance(first, second) {
        const aspectRatio = video.videoWidth && video.videoHeight
          ? video.videoWidth / video.videoHeight
          : 1;
        const deltaX = (first.x - second.x) * aspectRatio;
        const deltaY = first.y - second.y;
        return Math.hypot(deltaX, deltaY);
      }

      function hasFiveExtendedFingers(landmarks) {
        if (!landmarks || landmarks.length < 21) return false;
        const wrist = landmarks[0];
        const fingerJoints = [[8, 6], [12, 10], [16, 14], [20, 18]];
        const straightFingers = fingerJoints.every(([tip, joint]) =>
          pointDistance(wrist, landmarks[tip]) > pointDistance(wrist, landmarks[joint]) * 1.12
        );
        const thumbIsExtended =
          pointDistance(landmarks[2], landmarks[4]) > pointDistance(landmarks[2], landmarks[3]) * 1.2;
        return straightFingers && thumbIsExtended;
      }

      function updateGestureDetection(landmarks) {
        const fiveFingers = hasFiveExtendedFingers(landmarks);
        if (fiveFingers) {
          gestureStableFrames += 1;
          gestureReleaseFrames = 0;
          if (gestureStableFrames >= 6 && gestureArmed) {
            gestureArmed = false;
            if (photos.length >= maxPhotos) {
              setGestureStatus("Photostrip penuh. Mulai lagi untuk mengambil foto berikutnya.", "detected");
            } else if (capturing || sessionRunning) {
              setGestureStatus("Lima jari terdeteksi. Tunggu foto selesai, lalu lepaskan tangan.", "detected");
            } else {
              setGestureStatus("Lima jari terdeteksi! Foto akan diambil.", "detected");
              takePhoto();
            }
          }
          return;
        }

        gestureStableFrames = 0;
        gestureReleaseFrames += 1;
        if (gestureReleaseFrames >= 4) {
          gestureArmed = true;
          setGestureStatus("Sensor aktif — tunjukkan lima jari untuk mengambil foto.", "ready");
        }
      }

      function runGestureDetection() {
        if (!gestureEnabled || !handLandmarker) return;
        const now = performance.now();
        if (
          cameraStream &&
          now - lastGestureDetectionAt >= 100 &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.currentTime !== lastGestureVideoTime
        ) {
          lastGestureDetectionAt = now;
          lastGestureVideoTime = video.currentTime;
          try {
            const result = handLandmarker.detectForVideo(video, now);
            updateGestureDetection(result.landmarks[0]);
          } catch (error) {
            console.error("Hand gesture detection failed.", error);
            stopGestureSensor();
            setGestureStatus("Sensor gestur mengalami kendala. Matikan lalu aktifkan kembali sensor.", "error");
            return;
          }
        }
        gestureAnimationFrame = window.requestAnimationFrame(runGestureDetection);
      }

      function stopGestureSensor() {
        gestureEnabled = false;
        if (gestureAnimationFrame) window.cancelAnimationFrame(gestureAnimationFrame);
        gestureAnimationFrame = 0;
        if (handLandmarker) {
          handLandmarker.close();
          handLandmarker = null;
        }
        lastGestureVideoTime = -1;
        lastGestureDetectionAt = 0;
        gestureStableFrames = 0;
        gestureReleaseFrames = 0;
        gestureArmed = true;
        gestureButton.setAttribute("aria-pressed", "false");
        gestureButtonLabel.textContent = "Sensor 5 jari";
        setGestureStatus("Sensor mati. Aktifkan sensor, lalu tunjukkan lima jari.", "idle");
      }

      async function toggleGestureSensor() {
        if (gestureLoading) return;
        if (gestureEnabled) {
          stopGestureSensor();
          return;
        }

        gestureLoading = true;
        gestureButton.disabled = true;
        cameraButton.disabled = true;
        flipCameraButton.disabled = true;
        setGestureStatus("Menyiapkan sensor dan model pengenal gestur…", "loading");
        clearCameraError();
        try {
          if (!cameraStream) {
            await toggleCamera();
            cameraButton.disabled = true;
            if (!cameraStream) {
              setGestureStatus("Kamera belum aktif. Izinkan kamera, lalu coba nyalakan sensor lagi.", "error");
              return;
            }
          }

          const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
          const files = await vision.FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
          );
          handLandmarker = await vision.HandLandmarker.createFromOptions(files, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: .6,
            minHandPresenceConfidence: .6,
            minTrackingConfidence: .55
          });
          gestureEnabled = true;
          gestureButton.setAttribute("aria-pressed", "true");
          gestureButtonLabel.textContent = "Matikan sensor";
          setGestureStatus("Sensor aktif — tunjukkan lima jari untuk mengambil foto.", "ready");
          runGestureDetection();
        } catch (error) {
          console.error("Unable to initialize the five-finger photo sensor.", error);
          if (handLandmarker) {
            handLandmarker.close();
            handLandmarker = null;
          }
          setGestureStatus("Sensor gagal dimuat. Periksa internet dan coba aktifkan lagi.", "error");
          showCameraError("Sensor 5 jari memerlukan internet untuk memuat model pengenal. Kamera dan unggah foto tetap bisa digunakan tanpa sensor.");
        } finally {
          gestureLoading = false;
          gestureButton.disabled = false;
          cameraButton.disabled = false;
          flipCameraButton.disabled = false;
        }
      }

      function drawCover(context, image, x, y, width, height, filter) {
        const sourceWidth = image.videoWidth || image.naturalWidth || image.width;
        const sourceHeight = image.videoHeight || image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) return;
        const scale = Math.max(width / sourceWidth, height / sourceHeight);
        const cropWidth = width / scale;
        const cropHeight = height / scale;
        const cropX = (sourceWidth - cropWidth) / 2;
        const cropY = (sourceHeight - cropHeight) / 2;
        context.save();
        context.filter = filter;
        context.drawImage(image, cropX, cropY, cropWidth, cropHeight, x, y, width, height);
        context.restore();
      }

      function addPhoto(image) {
        if (photos.length >= maxPhotos) return false;
        photos.push(image);
        updatePhotoCount();
        renderStrip();
        return true;
      }

      function updatePhotoCount() {
        shotCount.textContent = `${photos.length} dari ${maxPhotos} foto`;
        stripCount.textContent = photos.length ? `${photos.length} FOTO` : "BELUM ADA FOTO";
        document.querySelector(".strip-hint").textContent = `Maksimal ${maxPhotos} foto dalam satu sesi fotobox.`;
        captureButton.disabled = !cameraStream || (photos.length >= maxPhotos && retakeIndex === null) || capturing || sessionRunning;
        captureLabel.textContent = retakeIndex !== null ? `Ulang foto ${retakeIndex + 1}` : photos.length >= maxPhotos ? "Foto lengkap" : "Ambil foto";
        uploadInput.disabled = photos.length >= maxPhotos || sessionRunning || retakeIndex !== null;
        downloadButton.disabled = photos.length === 0;
        resetButton.disabled = photos.length === 0;
        photoCountSelect.disabled = sessionRunning;
        sessionButton.disabled = (!cameraStream && !sessionRunning) || (capturing && !sessionRunning);
        sessionButton.classList.toggle("is-running", sessionRunning);
        sessionButtonLabel.textContent = sessionRunning
          ? "Hentikan sesi"
          : photos.length >= maxPhotos
            ? "Sesi selesai"
            : retakeIndex !== null
              ? "Selesaikan foto ulang"
              : "Mulai sesi fotobox";
        renderPhotoGallery();
      }

      function renderPhotoGallery() {
        photoGallery.replaceChildren();
        photos.forEach((photo, index) => {
          const card = document.createElement("article");
          card.className = "photo-card";

          const image = document.createElement("img");
          image.className = "photo-card-image";
          image.src = photo.src;
          image.alt = `Hasil foto ${index + 1}`;
          image.loading = "lazy";
          card.appendChild(image);

          const meta = document.createElement("div");
          meta.className = "photo-card-meta";
          meta.textContent = `POSE ${String(index + 1).padStart(2, "0")}`;
          card.appendChild(meta);

          const actions = document.createElement("div");
          actions.className = "photo-card-actions";
          const retakeButton = document.createElement("button");
          retakeButton.className = "photo-card-button";
          retakeButton.type = "button";
          retakeButton.dataset.action = "retake";
          retakeButton.textContent = "↻ Ulang";
          retakeButton.setAttribute("aria-label", `Ulangi foto ${index + 1}`);
          retakeButton.disabled = sessionRunning;
          retakeButton.addEventListener("click", () => selectPhotoForRetake(index));
          actions.appendChild(retakeButton);

          const deleteButton = document.createElement("button");
          deleteButton.className = "photo-card-button";
          deleteButton.type = "button";
          deleteButton.dataset.action = "delete";
          deleteButton.textContent = "× Hapus";
          deleteButton.setAttribute("aria-label", `Hapus foto ${index + 1}`);
          deleteButton.disabled = sessionRunning;
          deleteButton.addEventListener("click", () => removePhoto(index));
          actions.appendChild(deleteButton);
          card.appendChild(actions);
          photoGallery.appendChild(card);
        });
      }

      async function selectPhotoForRetake(index) {
        if (sessionRunning || index < 0 || index >= photos.length) return;
        retakeIndex = index;
        setSessionStatus(`Foto ${index + 1} dipilih untuk diulang. Nyalakan kamera lalu tekan Ambil foto.`, "active");
        updatePhotoCount();
        if (!cameraStream) await toggleCamera();
        updatePhotoCount();
      }

      function removePhoto(index) {
        if (sessionRunning || index < 0 || index >= photos.length) return;
        photos.splice(index, 1);
        if (retakeIndex === index) retakeIndex = null;
        else if (retakeIndex !== null && retakeIndex > index) retakeIndex -= 1;
        setSessionStatus("Foto dihapus. Ambil lagi atau lanjutkan sesi fotobox.");
        updatePhotoCount();
        renderStrip();
      }

      function fitCanvasText(context, text, x, y, maxWidth) {
        const value = text.trim();
        if (!value) return;
        context.fillText(value, x, y, maxWidth);
      }

      function roundedRect(context, x, y, width, height, radius) {
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
      }

      function createFramePattern(context, motif, color) {
        const tile = document.createElement("canvas");
        const tileContext = tile.getContext("2d");
        tile.width = 48;
        tile.height = 48;
        tileContext.strokeStyle = color;
        tileContext.fillStyle = color;
        tileContext.globalAlpha = .68;

        if (motif === "dots") {
          [[12, 12], [36, 36]].forEach(([x, y]) => {
            tileContext.beginPath();
            tileContext.arc(x, y, 4, 0, Math.PI * 2);
            tileContext.fill();
          });
        } else if (motif === "gingham") {
          tileContext.globalAlpha = .28;
          tileContext.lineWidth = 8;
          tileContext.beginPath();
          tileContext.moveTo(12, 0);
          tileContext.lineTo(12, 48);
          tileContext.moveTo(36, 0);
          tileContext.lineTo(36, 48);
          tileContext.moveTo(0, 12);
          tileContext.lineTo(48, 12);
          tileContext.moveTo(0, 36);
          tileContext.lineTo(48, 36);
          tileContext.stroke();
        } else {
          tileContext.textAlign = "center";
          tileContext.textBaseline = "middle";
          tileContext.font = motif === "stars" ? "20px Georgia, serif" : "21px Georgia, serif";
          tileContext.fillText(motif === "stars" ? "✦" : "♡", 12, 13);
          tileContext.fillText(motif === "stars" ? "✧" : "♥", 36, 37);
        }

        return context.createPattern(tile, "repeat");
      }

      function applyPhotoEffect(context, x, y, width, height) {
        if (activeEffect === "none") return;
        context.save();
        roundedRect(context, x, y, width, height, 13);
        context.clip();

        if (activeEffect === "glow") {
          const glow = context.createRadialGradient(
            x + width * .48, y + height * .12, 0,
            x + width * .48, y + height * .12, width * .78
          );
          glow.addColorStop(0, "rgba(255, 246, 220, .48)");
          glow.addColorStop(1, "rgba(255, 246, 220, 0)");
          context.fillStyle = glow;
          context.fillRect(x, y, width, height);
        } else if (activeEffect === "lightleak") {
          const leak = context.createLinearGradient(x, y, x + width, y + height);
          leak.addColorStop(0, "rgba(255, 172, 108, .43)");
          leak.addColorStop(.35, "rgba(255, 172, 108, 0)");
          leak.addColorStop(.72, "rgba(247, 132, 160, 0)");
          leak.addColorStop(1, "rgba(247, 132, 160, .32)");
          context.fillStyle = leak;
          context.fillRect(x, y, width, height);
        } else if (activeEffect === "sparkle") {
          const sparkles = [
            [.13, .18, 5], [.78, .13, 4], [.88, .53, 5],
            [.22, .76, 4], [.66, .84, 5], [.48, .35, 3]
          ];
          context.fillStyle = "rgba(255, 255, 245, .94)";
          context.shadowColor = "rgba(255, 248, 210, .9)";
          context.shadowBlur = 12;
          sparkles.forEach(([relativeX, relativeY, radius]) => {
            const centerX = x + width * relativeX;
            const centerY = y + height * relativeY;
            context.beginPath();
            context.moveTo(centerX, centerY - radius);
            context.lineTo(centerX + radius * .3, centerY - radius * .3);
            context.lineTo(centerX + radius, centerY);
            context.lineTo(centerX + radius * .3, centerY + radius * .3);
            context.lineTo(centerX, centerY + radius);
            context.lineTo(centerX - radius * .3, centerY + radius * .3);
            context.lineTo(centerX - radius, centerY);
            context.lineTo(centerX - radius * .3, centerY - radius * .3);
            context.closePath();
            context.fill();
          });
        }

        context.restore();
      }

      function renderStrip() {
        if (!photos.length) {
          stripCanvas.classList.remove("is-visible");
          stripPlaceholder.classList.remove("is-hidden");
          return;
        }

        const layouts = {
          strip: { width: 760, columns: 1, outer: 48, imageHeight: 340, labelHeight: 55, gap: 26 },
          grid: { width: 900, columns: 2, outer: 48, imageHeight: 300, labelHeight: 48, gap: 22 },
          polaroid: { width: 1000, columns: 3, outer: 32, imageHeight: 295, labelHeight: 58, gap: 16 }
        };
        const layout = layouts[activeLayout];
        const headerHeight = 178;
        const footerHeight = 100;
        const rows = Math.ceil(photos.length / layout.columns);
        const contentHeight = rows * (layout.imageHeight + layout.labelHeight) + Math.max(0, rows - 1) * layout.gap;
        const height = headerHeight + contentHeight + footerHeight;
        const width = layout.width;
        const context = stripCanvas.getContext("2d");
        const style = frameStyles[activeFrame];
        const borderPattern = createFramePattern(context, activePattern, patternColors[activeFrame]);
        stripCanvas.width = width;
        stripCanvas.height = height;

        context.fillStyle = style.paper;
        context.fillRect(0, 0, width, height);
        context.strokeStyle = borderPattern;
        context.lineWidth = 16;
        context.strokeRect(10, 10, width - 20, height - 20);
        context.fillStyle = style.accent;
        context.beginPath();
        context.arc(55, 53, 5, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(width - 55, 53, 5, 0, Math.PI * 2);
        context.fill();

        context.textAlign = "center";
        context.fillStyle = style.text;
        context.font = "700 19px 'Segoe UI', sans-serif";
        context.fillText("RUANG BERDUA  •  PHOTOBOOTH", width / 2, 60);
        context.fillStyle = style.accent;
        context.font = "italic 38px Georgia, serif";
        fitCanvasText(context, coupleNames.value || "momen kita", width / 2, 112, width - 100);

        photos.forEach((photo, index) => {
          const column = index % layout.columns;
          const row = Math.floor(index / layout.columns);
          const cardWidth = (width - layout.outer * 2 - layout.gap * (layout.columns - 1)) / layout.columns;
          const x = layout.outer + column * (cardWidth + layout.gap);
          const y = headerHeight + row * (layout.imageHeight + layout.labelHeight + layout.gap);
          const imageY = y;
          const imageHeight = layout.imageHeight;
          context.save();
          roundedRect(context, x, imageY, cardWidth, imageHeight, 13);
          context.clip();
          drawCover(context, photo, x, imageY, cardWidth, imageHeight, filters[activeFilter]);
          applyPhotoEffect(context, x, imageY, cardWidth, imageHeight);
          context.restore();

          context.strokeStyle = borderPattern;
          context.lineWidth = 6;
          roundedRect(context, x, imageY, cardWidth, imageHeight, 13);
          context.stroke();
          if (activeSticker) {
            context.save();
            context.textAlign = "right";
            context.fillStyle = style.accent;
            context.font = "34px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
            context.shadowColor = "rgba(54, 35, 54, .24)";
            context.shadowBlur = 10;
            context.fillText(activeSticker, x + cardWidth - 14, imageY + 43);
            context.restore();
          }
          context.textAlign = "left";
          context.fillStyle = style.text;
          context.font = "700 13px 'Segoe UI', sans-serif";
          context.fillText(`MOMEN ${String(index + 1).padStart(2, "0")}`, x + 3, y + imageHeight + 28);
          context.textAlign = "right";
          context.fillStyle = style.accent;
          context.font = "20px Georgia, serif";
          context.fillText("♡", x + cardWidth - 3, y + imageHeight + 29);
        });

        context.textAlign = "center";
        context.fillStyle = style.text;
        context.globalAlpha = .8;
        context.font = "italic 17px Georgia, serif";
        fitCanvasText(context, coupleCaption.value || "always better, together", width / 2, height - 33, width - 100);
        context.globalAlpha = 1;
        stripCanvas.classList.add("is-visible");
        stripPlaceholder.classList.add("is-hidden");
      }

      function takePhoto() {
        if (!cameraStream || capturing || (photos.length >= maxPhotos && retakeIndex === null)) {
          return Promise.resolve(false);
        }

        capturing = true;
        updatePhotoCount();
        let seconds = Number(timerSelect.value);

        return new Promise((resolve) => {
          activeCaptureResolve = resolve;
          const finish = (captured) => {
            if (countdownTimer) window.clearInterval(countdownTimer);
            if (captureFinishTimer) window.clearTimeout(captureFinishTimer);
            countdownTimer = null;
            captureFinishTimer = null;
            countdown.classList.remove("is-visible");
            capturing = false;
            activeCaptureResolve = null;
            updatePhotoCount();
            resolve(captured);
          };

          const captureFrame = () => {
            countdown.textContent = "♡";
            cameraStage.classList.add("is-flashing");
            window.setTimeout(() => cameraStage.classList.remove("is-flashing"), 180);
            captureFinishTimer = window.setTimeout(() => {
              captureFinishTimer = null;
              if (!cameraStream) {
                finish(false);
                return;
              }
              const photoCanvas = document.createElement("canvas");
              photoCanvas.width = video.videoWidth || 1280;
              photoCanvas.height = video.videoHeight || 720;
              const context = photoCanvas.getContext("2d");
              if (facingMode === "user") {
                context.translate(photoCanvas.width, 0);
                context.scale(-1, 1);
              }
              context.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);
              const image = new Image();
              image.onload = () => {
                if (retakeIndex !== null && retakeIndex < photos.length) {
                  photos[retakeIndex] = image;
                  retakeIndex = null;
                  setSessionStatus("Foto berhasil diulang.");
                  updatePhotoCount();
                  renderStrip();
                } else {
                  addPhoto(image);
                }
                finish(true);
              };
              image.onerror = () => {
                showCameraError("Foto tidak berhasil diproses. Silakan coba ambil foto lagi.");
                finish(false);
              };
              image.src = photoCanvas.toDataURL("image/jpeg", .92);
            }, 320);
          };

          countdown.classList.add("is-visible");
          if (seconds === 0) {
            captureFrame();
            return;
          }
          countdown.textContent = seconds;
          countdownTimer = window.setInterval(() => {
            seconds -= 1;
            if (seconds > 0) {
              countdown.textContent = seconds;
              return;
            }
            window.clearInterval(countdownTimer);
            countdownTimer = null;
            captureFrame();
          }, 1000);
        });
      }

      function cancelActiveCapture() {
        if (!capturing) return;
        if (countdownTimer) window.clearInterval(countdownTimer);
        if (captureFinishTimer) window.clearTimeout(captureFinishTimer);
        countdownTimer = null;
        captureFinishTimer = null;
        countdown.classList.remove("is-visible");
        capturing = false;
        const resolve = activeCaptureResolve;
        activeCaptureResolve = null;
        updatePhotoCount();
        if (resolve) resolve(false);
      }

      async function runPhotoSession() {
        if (sessionRunning) {
          sessionRunning = false;
          sessionGeneration += 1;
          cancelActiveCapture();
          setSessionStatus("Sesi dihentikan. Foto yang sudah diambil tetap tersimpan.");
          updatePhotoCount();
          return;
        }
        if (retakeIndex !== null) {
          setSessionStatus("Selesaikan foto ulang yang dipilih sebelum memulai sesi baru.", "active");
          return;
        }
        if (photos.length >= maxPhotos) {
          setSessionStatus("Semua slot sudah terisi. Hapus foto atau mulai lagi untuk sesi baru.", "complete");
          return;
        }
        if (!cameraStream) {
          setSessionStatus("Nyalakan kamera sebelum memulai sesi fotobox.");
          return;
        }

        const generation = ++sessionGeneration;
        sessionRunning = true;
        updatePhotoCount();
        try {
          while (sessionRunning && generation === sessionGeneration && photos.length < maxPhotos) {
            const pose = photos.length + 1;
            setSessionStatus(`Pose ${pose} dari ${maxPhotos} — bersiap untuk foto…`, "active");
            const captured = await takePhoto();
            if (!captured) break;
            if (!sessionRunning || generation !== sessionGeneration) break;
            if (photos.length < maxPhotos) {
              setSessionStatus(`${photos.length} dari ${maxPhotos} foto — pose berikutnya sebentar lagi.`, "active");
              await new Promise((resolve) => window.setTimeout(resolve, 850));
            }
          }
        } finally {
          if (generation === sessionGeneration) {
            sessionRunning = false;
            updatePhotoCount();
            if (photos.length >= maxPhotos) {
              setSessionStatus("Sesi selesai! Pilih foto yang mau diulang, lalu simpan photostrip.", "complete");
            } else if (photos.length > 0) {
              setSessionStatus("Sesi berhenti. Kamu bisa lanjutkan dengan tombol sesi atau ambil foto manual.");
            }
          }
        }
      }

      function loadImage(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("File foto tidak dapat dibaca."));
          reader.onload = () => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Foto "${file.name}" tidak dapat dibuka.`));
            image.src = reader.result;
          };
          reader.readAsDataURL(file);
        });
      }

      async function uploadPhotos(event) {
        clearCameraError();
        const files = Array.from(event.target.files || []);
        const available = maxPhotos - photos.length;
        if (files.length > available) {
          showCameraError(`Photostrip hanya memuat ${maxPhotos} foto. Pilih maksimal ${available} foto lagi.`);
        }
        for (const file of files.slice(0, available)) {
          try {
            const image = await loadImage(file);
            addPhoto(image);
          } catch (error) {
            showCameraError(error.message);
          }
        }
        uploadInput.value = "";
      }

      async function downloadStrip() {
        if (!photos.length) return;
        try {
          const blob = await new Promise((resolve, reject) => {
            stripCanvas.toBlob((result) => {
              if (result) resolve(result);
              else reject(new Error("Photostrip tidak dapat dibuat."));
            }, "image/png");
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "ruang-berdua-photostrip.png";
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
          showCameraError("Photostrip belum bisa disimpan. Coba lagi atau gunakan fitur tangkapan layar browser.");
        }
      }

      function resetPhotos() {
        if (sessionRunning) {
          sessionRunning = false;
          sessionGeneration += 1;
          cancelActiveCapture();
        }
        photos.length = 0;
        retakeIndex = null;
        clearCameraError();
        setSessionStatus("Sesi baru siap dimulai.");
        updatePhotoCount();
        renderStrip();
      }

      cameraButton.addEventListener("click", toggleCamera);
      flipCameraButton.addEventListener("click", flipCamera);
      gestureButton.addEventListener("click", toggleGestureSensor);
      captureButton.addEventListener("click", takePhoto);
      sessionButton.addEventListener("click", runPhotoSession);
      uploadInput.addEventListener("change", uploadPhotos);
      downloadButton.addEventListener("click", downloadStrip);
      resetButton.addEventListener("click", resetPhotos);
      coupleNames.addEventListener("input", renderStrip);
      coupleCaption.addEventListener("input", renderStrip);
      layoutSelect.addEventListener("change", () => {
        activeLayout = layoutSelect.value;
        renderStrip();
      });

      photoCountSelect.addEventListener("change", () => {
        const selectedCount = Number(photoCountSelect.value);
        if (photos.length > selectedCount) {
          showCameraError(`Kalian sudah punya ${photos.length} foto. Hapus beberapa foto sebelum memilih batas yang lebih kecil.`);
          photoCountSelect.value = String(maxPhotos);
          return;
        }
        maxPhotos = selectedCount;
        clearCameraError();
        setSessionStatus(`Sesi fotobox diatur untuk ${maxPhotos} foto.`);
        updatePhotoCount();
        renderStrip();
      });

      document.querySelectorAll(".swatch").forEach((button) => {
        button.addEventListener("click", () => {
          activeFrame = button.dataset.frame;
          document.querySelectorAll(".swatch").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
          cameraStage.dataset.frame = activeFrame;
          renderStrip();
        });
      });

      document.querySelectorAll("[data-filter]").forEach((button) => {
        button.addEventListener("click", () => {
          activeFilter = button.dataset.filter;
          document.querySelectorAll("[data-filter]").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
          applyLiveFilter();
          renderStrip();
        });
      });

      document.querySelectorAll("button[data-effect]").forEach((button) => {
        button.addEventListener("click", () => {
          activeEffect = button.dataset.effect;
          document.querySelectorAll("button[data-effect]").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
          applyLiveFilter();
          renderStrip();
        });
      });

      document.querySelectorAll("[data-sticker]").forEach((button) => {
        button.addEventListener("click", () => {
          activeSticker = button.dataset.sticker;
          document.querySelectorAll("[data-sticker]").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
          renderStrip();
        });
      });

      document.querySelectorAll("[data-pattern]").forEach((button) => {
        button.addEventListener("click", () => {
          activePattern = button.dataset.pattern;
          document.querySelectorAll("[data-pattern]").forEach((item) => {
            item.setAttribute("aria-pressed", String(item === button));
          });
          renderStrip();
        });
      });

      window.addEventListener("pagehide", () => {
        sessionRunning = false;
        sessionGeneration += 1;
        cancelActiveCapture();
        if (gestureAnimationFrame) window.cancelAnimationFrame(gestureAnimationFrame);
        if (handLandmarker) handLandmarker.close();
        if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
        if (countdownTimer) window.clearInterval(countdownTimer);
      });

      updatePhotoCount();
    })();
