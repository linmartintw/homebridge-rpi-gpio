import {
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  type PlatformAccessory,
} from 'homebridge';
import type { RpiHomebridgePlatform } from './rpiPlatform.js';
import { GpioBase } from './gpioCommon.js';
import { Direction, Gpio } from 'onoff';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RpiPlatformAccessoryGpioInput extends GpioBase {

  constructor(
    platform: RpiHomebridgePlatform,
    accessory: PlatformAccessory,
  ) {
    super(platform, accessory, platform.Service.ContactSensor);

    if (this.device.group) {
      this.platform.log.debug(`Registering input pin ${this.device.pin} to group ${this.device.group}`);
      this.platform.gpioStateManager.registerPinToGroup(this.device.pin, this.device.group);
    }
  }

  protected override setupServiceHandling(): void {
    // set the handler of GET
    this.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .on(CharacteristicEventTypes.GET, this.getState.bind(this));
  }

  protected override onGpioInitialized(): void {
    this.platform.log.info(`GPIO Contact Sensor initialized on pin ${this.device.pin}`);
  }

  getState(callback: CharacteristicGetCallback): void {
    try {

      const value = this.gpio ? this.gpio.readSync() : undefined;

      if (value === undefined) {
        this.platform.log.warn(`Cannot read from GPIO ${this.device.pin}, returning default state`);
        callback(null, this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED);
        return;
      }

      const effectiveValue = this.applyInversion(value);

      const state = effectiveValue === 0
        ? this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
        : this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

      // Update the state in the state manager
      const booleanState = effectiveValue === 0;
      this.platform.gpioStateManager.updateStateGpioInput(this.device.pin, booleanState);

      this.platform.log.debug(`Read sensor state for GPIO ${this.device.pin}: ${effectiveValue} ` +
        `(${state === 0 ? 'CONTACT DETECTED' : 'CONTACT NOT DETECTED'})`);

      callback(null, state);

    } catch (error) {
      this.platform.log.error(`Error reading GPIO ${this.device.pin}:`, error);
      callback(null, this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED);
    }

  }

  protected initGpio(): boolean {
    try {
      const options = {
        debounceTimeout: this.device.debounceMs,
      };

      // Create GPIO instance
      this.gpio = new Gpio(this.device.pin, this.device.direction as Direction, 'both', options);

      // read the first state and update state
      const initValue = this.gpio.readSync();
      this.updateSensorState(initValue);

      // watchdog
      this.setupGpioWatchDog();

      return true;

    } catch (error) {
      this.platform.log.error(`Failed to initialize GPIO ${this.device.pin}:`, error);
      return false;
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

      this.updateSensorState(value);
    });

  }

  private updateSensorState(value: number): void {
    const effectiveValue = this.applyInversion(value);

    const state = effectiveValue === 0
      ? this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

    const booleanState = effectiveValue === 0;
    this.platform.gpioStateManager.updateStateGpioInput(this.device.pin, booleanState);

    this.platform.log.info(`GPIO ${this.device.pin} value: ${value} ` +
      `state changed: ${effectiveValue} (${state === 0 ? 'CONTACT DETECTED' : 'CONTACT NOT DETECTED'})`);
    this.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, state);
  }
}
