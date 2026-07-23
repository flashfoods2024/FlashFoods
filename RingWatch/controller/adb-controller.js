/**
 * @file ADB Controller
 * @description Android Debug Bridge interface for device control and notification monitoring.
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

const execAsync = promisify(exec);

/**
 * @class AdbController
 * @description Controls an Android device via ADB for notification testing.
 */
export class AdbController {
  /**
   * @param {object} [config] - Override config
   * @param {string} [deviceId] - Specific device serial (auto-detected if omitted)
   */
  constructor(config, deviceId) {
    this._config = config || getConfig();
    this._logger = getLogger();
    this._adb = this._config.adb?.binary || 'adb';
    this._deviceId = deviceId || null;
    this._connected = false;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Execute an ADB command.
   * @param {string} args - ADB arguments
   * @param {object} [options]
   * @param {boolean} [options.ignoreError=false]
   * @returns {Promise<string>} stdout
   * @throws {Error} if the command fails and ignoreError is false
   */
  async _adbExec(args, options = {}) {
    const deviceArg = this._deviceId ? ` -s ${this._deviceId}` : '';
    const cmd = `${this._adb}${deviceArg} ${args}`;
    try {
      this._logger.debug(`ADB: ${cmd}`);
      const { stdout, stderr } = await execAsync(cmd, { timeout: 15000 });
      if (stderr && !options.ignoreError) {
        this._logger.warn(`ADB stderr: ${stderr.trim()}`);
      }
      return stdout.trim();
    } catch (err) {
      if (options.ignoreError) return '';
      this._logger.error(`ADB command failed: ${cmd}`, { error: err.message });
      throw new Error(`ADB error: ${err.message}`);
    }
  }

  /**
   * Execute an ADB command synchronously (for bootstrapping).
   * @param {string} args
   * @param {object} [options]
   * @returns {string}
   */
  _adbExecSync(args, options = {}) {
    const deviceArg = this._deviceId ? ` -s ${this._deviceId}` : '';
    const cmd = `${this._adb}${deviceArg} ${args}`;
    try {
      return execSync(cmd, { timeout: 15000, windowsHide: true }).toString().trim();
    } catch (err) {
      if (options.ignoreError) return '';
      throw new Error(`ADB error: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Device Detection & Verification
  // --------------------------------------------------------------------------

  /**
   * Detect connected Android devices.
   * @returns {Promise<Array<{id:string, status:string}>>}
   */
  async detectDevices() {
    const output = await this._adbExec('devices', { ignoreError: true });
    if (!output) return [];

    const lines = output.split('\n').filter(l => l.trim() && !l.startsWith('List'));
    return lines.map(line => {
      const [id, status] = line.split(/\s+/);
      return { id, status: status || 'unknown' };
    }).filter(d => d.id);
  }

  /**
   * Verify USB debugging is enabled and device is authorised.
   * @param {string} [deviceId]
   * @returns {Promise<boolean>}
   */
  async verifyUsbDebugging(deviceId) {
    this._deviceId = deviceId || this._deviceId;
    const devices = await this.detectDevices();
    const device = devices.find(d => d.id === this._deviceId || !this._deviceId);
    if (!device) {
      this._logger.error('No Android device detected');
      return false;
    }
    if (device.status !== 'device') {
      this._logger.error(`Device ${device.id} status is "${device.status}" (expected "device")`);
      return false;
    }
    this._deviceId = device.id;
    this._connected = true;
    this._logger.info(`Device connected: ${device.id}`);
    return true;
  }

  // --------------------------------------------------------------------------
  // Power Management
  // --------------------------------------------------------------------------

  /** Wake the device (turn screen on). */
  async wakeDevice() {
    await this._adbExec('shell input keyevent KEYCODE_WAKEUP');
    this._logger.info('Device woken');
  }

  /** Put the device to sleep (turn screen off). */
  async sleepDevice() {
    await this._adbExec('shell input keyevent KEYCODE_SLEEP');
    this._logger.info('Device put to sleep');
  }

  /**
   * Check screen power state.
   * @returns {Promise<'on'|'off'|'unknown'>}
   */
  async checkScreenState() {
    const output = await this._adbExec('shell dumpsys power | grep "mWakefulness"', { ignoreError: true });
    if (output.includes('Awake') || output.includes('On')) return 'on';
    if (output.includes('Asleep') || output.includes('Off')) return 'off';
    return 'unknown';
  }

  // --------------------------------------------------------------------------
  // App Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Launch the FlashFoods app.
   * @param {string} [packageName] - Android package name
   */
  async launchApp(packageName) {
    const pkg = packageName || this._config.appPackage;
    await this._adbExec(`shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`, { ignoreError: true });
    this._logger.info(`Launched app: ${pkg}`);
  }

  /**
   * Force-close the FlashFoods app.
   * @param {string} [packageName]
   */
  async closeApp(packageName) {
    const pkg = packageName || this._config.appPackage;
    await this._adbExec(`shell am force-stop ${pkg}`, { ignoreError: true });
    this._logger.info(`Closed app: ${pkg}`);
  }

  // --------------------------------------------------------------------------
  // Logcat
  // --------------------------------------------------------------------------

  /**
   * Capture logcat output, optionally filtered.
   * @param {object} [options]
   * @param {string} [options.filter] - Logcat filter expression (e.g. "NotificationService:I *:S")
   * @param {number} [options.lines=100] - Max lines to capture
   * @param {number} [options.bufferSize] - Logcat buffer size
   * @returns {Promise<string>}
   */
  async captureLogcat(options = {}) {
    const filter = options.filter || '*:V';
    const lines = options.lines || 100;
    const bufferSize = options.bufferSize || this._config.adb?.logcatBufferSize || 8192;
    await this._adbExec(`logcat -G ${bufferSize}`, { ignoreError: true });
    const output = await this._adbExec(`logcat -d -t ${lines} ${filter}`, { ignoreError: true });
    return output;
  }

  /** Clear the logcat buffer. */
  async clearLogcat() {
    await this._adbExec('logcat -c', { ignoreError: true });
    this._logger.info('Logcat cleared');
  }

  // --------------------------------------------------------------------------
  // Notifications
  // --------------------------------------------------------------------------

  /**
   * Read notification history using dumpsys notification.
   * @returns {Promise<Array<{key:string, title:string, text:string, when:string, packageName:string}>>}
   */
  async readNotificationHistory() {
    const output = await this._adbExec('shell dumpsys notification --noredact', { ignoreError: true });
    return this._parseNotifications(output);
  }

  /**
   * Parse dumpsys notification output into structured objects.
   * @param {string} raw
   * @returns {Array<object>}
   */
  _parseNotifications(raw) {
    const notifications = [];
    const blocks = raw.split(/\n\s{2}/);

    for (const block of blocks) {
      if (!block.includes('NotificationRecord')) continue;

      const keyMatch = block.match(/key=([^\s]+)/);
      const titleMatch = block.match(/title=([^\n]+)/);
      const textMatch = block.match(/text=([^\n]+)/);
      const whenMatch = block.match(/when=([^\n]+)/);
      const pkgMatch = block.match(/Package\s+Names:\s*\[([^\]]+)\]/) || block.match(/pkg=([^\s]+)/);

      notifications.push({
        key: keyMatch ? keyMatch[1] : null,
        title: titleMatch ? titleMatch[1].replace(/^String\User\s*\{/, '').replace(/\}$/, '').trim() : null,
        text: textMatch ? textMatch[1].replace(/^String\User\s*\{/, '').replace(/\}$/, '').trim() : null,
        when: whenMatch ? whenMatch[1] : null,
        packageName: pkgMatch ? pkgMatch[1].replace(/[\[\]]/g, '') : null,
      });
    }

    return notifications;
  }

  // --------------------------------------------------------------------------
  // Device State
  // --------------------------------------------------------------------------

  /**
   * Check if battery saver is enabled.
   * @returns {Promise<boolean>}
   */
  async checkBatterySaver() {
    const output = await this._adbExec('shell dumpsys power | grep -i "battery.*saver\\|power.*save"', { ignoreError: true });
    return output.toLowerCase().includes('true');
  }

  /**
   * Check if the device is in doze mode.
   * @returns {Promise<boolean>}
   */
  async checkDozeMode() {
    const output = await this._adbExec('shell dumpsys deviceidle get deep', { ignoreError: true });
    return output.trim().toLowerCase() === 'idle';
  }

  /**
   * Collect a snapshot of current device state.
   * @returns {Promise<object>}
   */
  async collectDeviceState() {
    const [screenState, batterySaver, dozeMode, notifications] = await Promise.all([
      this.checkScreenState(),
      this.checkBatterySaver(),
      this.checkDozeMode(),
      this.readNotificationHistory(),
    ]);

    return {
      screenState,
      batterySaver,
      dozeMode,
      notificationCount: notifications.length,
      notifications,
      timestamp: new Date().toISOString(),
    };
  }

  /** @returns {boolean} Whether a device is connected */
  isConnected() { return this._connected; }

  /** @returns {string|null} The connected device serial */
  getDeviceId() { return this._deviceId; }

  /**
   * Execute an arbitrary ADB command.
   * @param {string} args - ADB arguments (e.g. "shell screencap -p /sdcard/screen.png")
   * @param {object} [options]
   * @param {boolean} [options.ignoreError=false]
   * @returns {Promise<string>} stdout
   */
  async exec(args, options = {}) {
    return this._adbExec(args, options);
  }
}

export default AdbController;
