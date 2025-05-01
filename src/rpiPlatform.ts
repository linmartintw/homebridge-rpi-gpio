import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { GpioDevice, GpioStateManager } from './gpioCommon.js';
import { RpiPlatformAccessoryGpioInput } from './platformAccessoryGpioInput.js';
import { RpiPlatformAccessoryGpioOutput } from './platformAccessoryGpioOutput.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';
import { exampleDevices } from './pinDescription.js';


// 定義配置接口
interface DeviceGroup {
    groupName: string;
    inputDebounceMs?: number;
    inputs?: InputDevice[];
    output?: OutputDevice;
  }

  interface InputDevice {
    name: string;
    bcmPort: string;
    invertState?: boolean;
  }

  interface OutputDevice {
    name: string;
    bcmPort: string;
    invertState?: boolean;
    forceOutput?: boolean;
    pollIntervalMs?: number;
  }


/**
 * RpiHomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class RpiHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  // This is only required when using Custom Services and Characteristics not support by HomeKit
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomServices: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly CustomCharacteristics: any;

  // GPIO state manager
  public readonly gpioStateManager: GpioStateManager;

  private deviceConfigs: GpioDevice[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // Initialize the GPIO state manager
    this.gpioStateManager = new GpioStateManager(this.log);

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    this.CustomServices = new EveHomeKitTypes(this.api).Services;
    this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');

      // 從配置加載設備
      this.loadDeviceConfigs();

      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });

    // setInterval(() => {
    //   this.gpioStateManager.displayAllGpioStates();
    // }, 1000);

  }

  /**
   * 從BCM port字符串獲取GPIO pin number
   * @param bcmPort BCM port字符串，如 'GPIO2'
   * @returns GPIO pin number，如果無效則返回-1
   */
  private getGpioPin(bcmPort: string): number {
    const match = bcmPort.match(/GPIO(\d+)/i);
    if (match && match[1]) {
      const gpioNumber = parseInt(match[1], 10);
      return 512 + gpioNumber; // GPIO0 = 512, GPIO1 = 513, 等等
    }
    return -1;
  }

  /**
   * 從配置文件中加載設備配置
   */
  private loadDeviceConfigs() {
    // 清空當前設備配置
    this.deviceConfigs = [];

    // 從配置中獲取設備群組
    const deviceGroups = this.config.deviceGroups as DeviceGroup[] || [];
    this.log.info(`Loading ${deviceGroups.length} device groups from config`);

    // 處理每個設備群組
    deviceGroups.forEach(group => {
      const groupName = group.groupName;

      // 獲取群組級別的輸入去抖動時間，如果未設置則使用默認值 250ms
      const inputDebounceMs = group.inputDebounceMs !== undefined ? group.inputDebounceMs : 250;

      // 處理輸入設備
      if (group.inputs && Array.isArray(group.inputs)) {
        group.inputs.forEach(input => {
          // 從BCM port獲取GPIO pin number
          const pin = this.getGpioPin(input.bcmPort);

          if (pin === -1) {
            this.log.error(`Invalid BCM port: ${input.bcmPort}`);
            return;
          }

          const device: GpioDevice = {
            name: input.name,
            group: groupName,
            pin: pin,
            bcmPort: input.bcmPort,
            direction: 'in',
            invertState: !!input.invertState,
            debounceMs: inputDebounceMs, // 使用群組級別的去抖動時間
          };

          this.deviceConfigs.push(device);
          this.log.debug(`Added input device: ${device.name}, BCM: ${device.bcmPort}, pin: ${pin}, group: ${device.group}, debounceMs: ${device.debounceMs}`);
        });
      }

      // 處理輸出設備 (保留原有的個別設置)
      if (group.output) {
        // 從BCM port獲取GPIO pin number
        const pin = this.getGpioPin(group.output.bcmPort);

        if (pin === -1) {
          this.log.error(`Invalid BCM port: ${group.output.bcmPort}`);
          return;
        }

        const device: GpioDevice = {
          name: group.output.name,
          group: groupName,
          pin: pin,
          bcmPort: group.output.bcmPort,
          direction: 'out',
          invertState: !!group.output.invertState,
          debounceMs: 0,
          pollIntervalMs: group.output.pollIntervalMs,
          forceOutput: group.output.forceOutput,
        };

        this.deviceConfigs.push(device);
        this.log.debug(`Added output device: ${device.name}, BCM: ${device.bcmPort}, pin: ${pin}, group: ${device.group}`);
      }
    });

    this.log.info(`Loaded ${this.deviceConfigs.length} total devices from config`);

    // 如果沒有從配置中讀取到設備，使用示例設備
    if (this.deviceConfigs.length === 0) {
      this.log.warn('No devices found in config, using example devices');
      this.deviceConfigs = [...exampleDevices];
    }
  }


  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverDevices() {
    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of this.deviceConfigs) {

      const accessoryDisplayName = device.name ? `${device.group}-${device.name}` : `${device.group}-${device.direction}-${device.bcmPort}`;

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(accessoryDisplayName);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`

        if (device.direction === 'in') {
          new RpiPlatformAccessoryGpioInput(this, existingAccessory);
        } else if (device.direction === 'out') {
          new RpiPlatformAccessoryGpioOutput(this, existingAccessory);
        } else {
          this.log.error(`Unknown direction for GPIO ${device.pin}: ${device.direction}`);
        }

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {

        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', accessoryDisplayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(accessoryDisplayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        if (device.direction === 'in') {
          new RpiPlatformAccessoryGpioInput(this, accessory);
        } else if (device.direction === 'out') {
          new RpiPlatformAccessoryGpioOutput(this, accessory);
        } else {
          this.log.error(`Unknown direction for GPIO ${device.pin}: ${device.direction}`);
        }

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
