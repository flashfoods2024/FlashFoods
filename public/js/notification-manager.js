class NotificationManager {
  constructor(shopId) {
    this.shopId = shopId;
    this.pendingOrderCount = 0;
    this.originalTitle = document.title;
    this.audio = null;
    this.isPlaying = false;
    this.socket = null;

    this.connect();
  }

  connect() {
    this.socket = io({ transports: ["websocket", "polling"] });

    this.socket.on("connect", () => {
      this.socket.emit("vendor:join", this.shopId);
    });

    this.socket.on("pending-count", (count) => {
      this.pendingOrderCount = count;
      this.updateState();
    });
  }

  updateState() {
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
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.audio = new Audio("/audio/ringing_sound.mp3");
    this.audio.loop = true;
    this.audio.volume = 1.0;

    this.audio.play().catch(() => {
      const resume = () => {
        if (this.isPlaying && this.audio) {
          this.audio.play();
        }
        document.removeEventListener("click", resume);
      };
      document.addEventListener("click", resume, { once: true });
    });
  }

  stopRinging() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
  }

  destroy() {
    this.stopRinging();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
