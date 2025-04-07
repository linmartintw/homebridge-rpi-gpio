import {
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  type PlatformAccessory,
  type Service,
} from 'homebridge';
import type { RpiHomebridgePlatform } from './rpiPlatform.js';
import { GpioDevice } from './pinDescription.js';
import { Direction, Gpio } from 'onoff';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RpiPlatformAccessoryGpioInput {
  private service: Service;
  private device: GpioDevice;
  private gpio: Gpio | null = null;
  private lastValue: number = 0;


  constructor(
    private readonly platform: RpiHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // Get the device information from accessory context
    this.device = accessory.context.device;

    const accessoryDisplayName = `${this.device.group}-${this.device.direction}-${this.device.bcmPort}`;

    // create ContactSensor service
    this.service = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessoryDisplayName);


    // set the handler of GET
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .on(CharacteristicEventTypes.GET,this.getState.bind(this));

    // set accessory information
    this.setupAccessoryInformation();

    // initialization Gpio
    if (this.initGpio()) {
      this.platform.log.info(`GPIO Contact Sensor initialized on pin ${this.device.pin}`);
    }

    // Setup Gpio shutdown hook
    this.platform.api.on('shutdown', () => {
      this.unexportGpio();
    });

  }

  getState(callback: CharacteristicGetCallback): void {
    try {

      const value = this.gpio ? this.gpio.readSync() : undefined;

      if (value === undefined) {
        this.platform.log.warn(`Cannot read from GPIO ${this.device.pin}, returning default state`);
        callback(null, this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED);
        return;
      }

      let effectiveValue = value;
      if (this.device.invertState) {
        effectiveValue = value === 1 ? 0 : 1;
      }
      const state = effectiveValue === 1
        ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;

      this.platform.log.debug(`Read sensor state for GPIO ${this.device.pin}: ${effectiveValue} ` +
        `(${state === 0 ? 'CONTACT DETECTED' : 'CONTACT NOT DETECTED'})`);

      callback(null, state);

    } catch (error) {
      this.platform.log.error(`Error reading GPIO ${this.device.pin}:`, error);
      callback(null, this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED);
    }

  }

  private setupAccessoryInformation(): void {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');
  }

  private initGpio(): boolean {
    try {
      const options = {
        debounceTimeout: this.device.debounceMs || 100,
      };

      // Create GPIO instance
      this.gpio = new Gpio(this.device.pin, this.device.direction as Direction, 'both', options);

      // read the first state and update state
      const initValue = this.gpio.readSync();
      this.lastValue = initValue;
      this.updateSensorState(initValue);

      // watchdog
      this.setupGpioWatchDog();

      return true;

    } catch (error) {
      this.platform.log.error(`Failed to initialize GPIO ${this.device.pin}:`, error);
      return false;
    }
  }

  async unexportGpio() {
    try {
      if (this.gpio) {
        this.gpio.unwatchAll();
        await this.gpio.unexport();
        this.gpio = null;
        this.platform.log.info(`GPIO pin ${this.device.pin} resources released`);
      }
    } catch (error) {
      this.platform.log.error(`Error releasing GPIO ${this.device.pin}:`, error);
    }
  }

  private setupGpioWatchDog(): void {
    if (!this.gpio) {
      return;
    }

    this.gpio.watch((err, value) => {
      if (err) {
        this.platform.log.error(`Error watching GPIO ${this.device.pin}:`, err);
        return;
      }

      if (value !== this.lastValue) {
        this.updateSensorState(value);
        this.lastValue = value;
      }

    });

  }

  private updateSensorState(value: number): void {
    let effectiveValue = value;

    // invert value
    if (this.device.invertState) {
      effectiveValue = value === 1 ? 0 : 1;
    }

    const state = effectiveValue === 1
      ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;

    this.platform.log.info(`GPIO ${this.device.pin} state changed: ${effectiveValue} (${state === 0 ? 'CONTACT DETECTED' : 'CONTACT NOT DETECTED'})`);
    this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, state);
  }
}
