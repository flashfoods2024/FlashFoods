class NotificationManager {
  constructor(shopId) {
    this.shopId = shopId;
    this.pendingOrderCount = 0;
    this.originalTitle = document.title;
    this.isPlaying = false;
    this.socket = null;

    const t0 = performance.now();
    this.audio = new Audio("/audio/ringing_sound.mp3");
    console.log(`[NM:ctor] Audio created — t=${(performance.now()-t0).toFixed(1)}ms`, {
      readyState: this.audio.readyState,
      networkState: this.audio.networkState,
      visibilityState: document.visibilityState,
    });

    this.audio.addEventListener('loadstart', () => {
      console.log(`[NM:audio:loadstart] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
    });

    this.audio.addEventListener('loadedmetadata', () => {
      console.log(`[NM:audio:loadedmetadata] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
        duration: this.audio.duration,
      });
    });

    this.audio.addEventListener('loadeddata', () => {
      console.log(`[NM:audio:loadeddata] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
    });

    this.audio.addEventListener('canplay', () => {
      console.log(`[NM:audio:canplay] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
    });

    this.audio.addEventListener('canplaythrough', () => {
      console.log(`[NM:audio:canplaythrough] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
    });

    this.audio.addEventListener('error', (e) => {
      const err = this.audio.error;
      console.log(`[NM:audio:error] t=${performance.now().toFixed(1)}ms`, {
        code: err ? err.code : null,
        message: err ? err.message : 'no error object',
        networkState: this.audio.networkState,
        readyState: this.audio.readyState,
        src: this.audio.src,
      });
    });

    this.audio.addEventListener('waiting', () => {
      console.log(`[NM:audio:waiting] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        networkState: this.audio.networkState,
      });
    });

    this.audio.addEventListener('playing', () => {
      console.log(`[NM:audio:playing] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
      });
    });

    this.audio.addEventListener('pause', () => {
      console.log(`[NM:audio:pause] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
        currentTime: this.audio.currentTime,
      });
    });

    this.audio.addEventListener('ended', () => {
      console.log(`[NM:audio:ended] t=${performance.now().toFixed(1)}ms`, {
        readyState: this.audio.readyState,
      });
    });

    this.audio.preload = "auto";
    this.audio.load();
    console.log(`[NM:ctor] load() called — t=${(performance.now()-t0).toFixed(1)}ms`, {
      readyState: this.audio.readyState,
      networkState: this.audio.networkState,
    });

    this._audioReady = this._ensureAudioReadyWithLogging(t0);

    document.addEventListener('visibilitychange', () => {
      console.log(`[NM:visibilitychange] t=${performance.now().toFixed(1)}ms`, {
        visibilityState: document.visibilityState,
        hidden: document.hidden,
        hasFocus: document.hasFocus(),
      });
    });

    this.connect();
    console.log(`[NM:ctor] connect() called — t=${(performance.now()-t0).toFixed(1)}ms`);
  }

  _ensureAudioReadyWithLogging(t0) {
    const readyNow = this.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    console.log(`[NM:_ensureAudioReady] t=${(performance.now()-t0).toFixed(1)}ms`, {
      readyState: this.audio.readyState,
      networkState: this.audio.networkState,
      readyNow,
    });

    if (readyNow) {
      console.log(`[NM:_ensureAudioReady] resolved synchronously`);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const canplayTs = performance.now();
      const onCanplay = () => {
        console.log(`[NM:_ensureAudioReady] canplay fired — t=${(performance.now()-canplayTs).toFixed(1)}ms`, {
          readyState: this.audio.readyState,
          networkState: this.audio.networkState,
        });
        resolve();
      };
      const onError = () => {
        const err = this.audio.error;
        console.log(`[NM:_ensureAudioReady] error fallback — t=${(performance.now()-canplayTs).toFixed(1)}ms`, {
          errorCode: err ? err.code : null,
          errorMsg: err ? err.message : 'unknown',
          readyState: this.audio.readyState,
          networkState: this.audio.networkState,
        });
        resolve();
      };
      this.audio.addEventListener('canplay', onCanplay, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
    });
  }

  connect() {
    this.socket = io({ transports: ["websocket", "polling"] });

    this.socket.on("connect", () => {
      console.log(`[NM:socket:connect] t=${performance.now().toFixed(1)}ms`, {
        id: this.socket.id,
        transport: this.socket.io ? this.socket.io.engine.transport.name : 'unknown',
      });
      this.socket.emit("vendor:join", this.shopId);
    });

    this.socket.on("pending-count", (count) => {
      console.log(`[NM:socket:pending-count] t=${performance.now().toFixed(1)}ms`, {
        count,
        isPlaying: this.isPlaying,
        audioReadyState: this.audio ? this.audio.readyState : 'no-audio',
        audioNetworkState: this.audio ? this.audio.networkState : 'no-audio',
        pendingOrderCount_before: this.pendingOrderCount,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });
      this.pendingOrderCount = count;
      this.updateState();
    });
  }

  updateState() {
    console.log(`[NM:updateState] t=${performance.now().toFixed(1)}ms`, {
      pendingOrderCount: this.pendingOrderCount,
      isPlaying: this.isPlaying,
    });
    this.updateTitle();
    this.updateSound();
  }

  updateTitle() {
    if (this.pendingOrderCount > 0) {
      document.title = `(${this.pendingOrderCount}) Pending Orders - Flash Foods`;
    } else {
      document.title = this.originalTitle;
    }
  }

  updateSound() {
    if (this.pendingOrderCount > 0) {
      this.startRinging();
    } else {
      this.stopRinging();
    }
  }

  startRinging() {
    const t0 = performance.now();
    if (this.isPlaying) {
      console.log(`[NM:startRinging] t=${t0.toFixed(1)}ms — SKIP (already playing)`);
      return;
    }

    this.isPlaying = true;
    this.audio.loop = true;
    this.audio.volume = 1.0;
    this.audio.currentTime = 0;

    console.log(`[NM:startRinging] t=${t0.toFixed(1)}ms`, {
      isPlaying: true,
      audioReadyState: this.audio.readyState,
      audioNetworkState: this.audio.networkState,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      audioSrc: this.audio.src,
    });

    this._audioReady.then(() => {
      const t1 = performance.now();
      console.log(`[NM:startRinging]_audioReady resolved — t=${t1.toFixed(1)}ms (Δ=${(t1-t0).toFixed(1)}ms)`, {
        isPlaying_now: this.isPlaying,
        audioReadyState: this.audio.readyState,
        audioNetworkState: this.audio.networkState,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });

      if (!this.isPlaying) {
        console.log(`[NM:startRinging] _audioReady.then — stopped before play, abort`);
        return;
      }

      const playPromise = this.audio.play();
      playPromise.then(() => {
        console.log(`[NM:startRinging] play() RESOLVED — t=${performance.now().toFixed(1)}ms`, {
          audioReadyState: this.audio.readyState,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        });
      }).catch((err) => {
        console.log(`[NM:startRinging] play() REJECTED — t=${performance.now().toFixed(1)}ms`, {
          errorName: err.name,
          errorMessage: err.message,
          errorCode: err.code,
          error: err.toString(),
          audioReadyState: this.audio.readyState,
          audioNetworkState: this.audio.networkState,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        });

        const resume = () => {
          const t2 = performance.now();
          console.log(`[NM:resume] fired — t=${t2.toFixed(1)}ms`, {
            isPlaying: this.isPlaying,
            hasAudio: !!this.audio,
            audioReadyState: this.audio ? this.audio.readyState : 'no-audio',
            audioNetworkState: this.audio ? this.audio.networkState : 'no-audio',
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
          });
          if (this.isPlaying && this.audio) {
            this.audio.currentTime = 0;
            const resumePlay = this.audio.play();
            resumePlay.then(() => {
              console.log(`[NM:resume] play() RESOLVED — t=${performance.now().toFixed(1)}ms`, {
                audioReadyState: this.audio.readyState,
                visibilityState: document.visibilityState,
              });
            }).catch((resumeErr) => {
              console.log(`[NM:resume] play() REJECTED — t=${performance.now().toFixed(1)}ms`, {
                errorName: resumeErr.name,
                errorMessage: resumeErr.message,
                error: resumeErr.toString(),
              });
            });
          }
          document.removeEventListener("click", resume);
        };
        document.addEventListener("click", resume, { once: true });
        console.log(`[NM:startRinging] click listener registered`);
      });
    });
  }

  stopRinging() {
    const t0 = performance.now();
    console.log(`[NM:stopRinging] t=${t0.toFixed(1)}ms`, {
      isPlaying_before: this.isPlaying,
      hasAudio: !!this.audio,
      audioReadyState: this.audio ? this.audio.readyState : 'no-audio',
      pendingOrderCount: this.pendingOrderCount,
    });

    if (!this.isPlaying) {
      console.log(`[NM:stopRinging] not playing — no-op`);
      return;
    }

    this.isPlaying = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    console.log(`[NM:stopRinging] done — t=${performance.now().toFixed(1)}ms`);
  }

  playReminder() {
    const t0 = performance.now();
    console.log(`[NM:playReminder] t=${t0.toFixed(1)}ms`, {
      isPlaying: this.isPlaying,
      hasAudio: !!this.audio,
      audioReadyState: this.audio ? this.audio.readyState : 'no-audio',
      audioNetworkState: this.audio ? this.audio.networkState : 'no-audio',
    });

    if (!this.audio) return;

    this._audioReady.then(() => {
      console.log(`[NM:playReminder]_audioReady resolved — t=${performance.now().toFixed(1)}ms (Δ=${(performance.now()-t0).toFixed(1)}ms)`, {
        isPlaying: this.isPlaying,
      });

      if (this.isPlaying) {
        this.audio.pause();
        this.audio.loop = false;
        this.audio.currentTime = 0;
        this.audio.play().catch(() => {});
        this.audio.addEventListener('ended', () => {
          if (this.isPlaying) {
            this.audio.loop = true;
            this.audio.currentTime = 0;
            this.audio.play().catch(() => {});
          }
        }, { once: true });
      } else {
        this.audio.currentTime = 0;
        this.audio.loop = false;
        this.audio.play().catch(() => {});
      }
    });
  }

  destroy() {
    this.stopRinging();
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  _ensureAudioReady() {
    return this._ensureAudioReadyWithLogging(performance.now());
  }
}
