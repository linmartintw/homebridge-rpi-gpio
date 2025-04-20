import {
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
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
export class RpiPlatformAccessoryGpioOutput extends GpioBase {
  private currentState: boolean = false;

  constructor(
    platform: RpiHomebridgePlatform,
    accessory: PlatformAccessory,
  ) {
    super(platform, accessory, platform.Service.Switch);

    if (this.device.group) {
      this.platform.log.debug(`Registering output pin ${this.device.pin} to group ${this.device.group}`);
      this.platform.gpioStateManager.registerPinToGroup(this.device.pin, this.device.group);
    }
  }

  protected override setupServiceHandling(): void {
    // set the handler of GET
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this))
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this));
  }

  protected override onGpioInitialized(): void {
    this.platform.log.info(`GPIO Switch initialized on pin ${this.device.pin}`);

    setTimeout(() => {
      this.updateBasedOnInputs();
      this.platform.log.debug(`Running initial update for GPIO ${this.device.pin} after initialization`);
    }, 1000);

    const pollingInverval = 1000;
    this.setupPolling(pollingInverval, this.updateBasedOnInputs.bind(this));
  }

  getOn(callback: CharacteristicGetCallback): void {
    const value = this.readCurrentGpioState();

    if (value !== undefined) {
      this.currentState = value;
    }
    callback(null, value !== undefined ? value : false);
  }

  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    try {
      const newState = !this.currentState;

      if (this.setGpioState(newState)) {
        this.currentState = newState;
        this.service.updateCharacteristic(this.platform.Characteristic.On, newState);

        this.platform.log.info(`Toggled GPIO ${this.device.pin} to ${newState ? 'ON' : 'OFF'}`);
        callback(null);
      } else {
        this.platform.log.error(`Failed to toggle GPIO ${this.device.pin}`);
        callback(new Error(`Failed to toggle GPIO ${this.device.pin}`));
      }
    } catch (error) {
      this.platform.log.error(`Error toggling GPIO ${this.device.pin}:`, error);
      callback(error as Error);
    }
  }

  protected initGpio(): boolean {
    try {

      // Create GPIO instance
      this.gpio = new Gpio(this.device.pin, this.device.direction as Direction);

      // read the first state and update state
      const initValue = this.gpio.readSync();
      const effectiveValue = this.gpioValueToBooleanWithInversion(initValue);

      this.currentState = effectiveValue;
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.currentState);

      this.platform.log.debug(`GPIO ${this.device.pin} initialized with state: ${this.currentState ? 'ON' : 'OFF'}`);

      return true;
    } catch (error) {
      this.platform.log.error(`Failed to initialize GPIO ${this.device.pin}:`, error);
      return false;
    }
  }

  protected override updateBasedOnInputs(): void {
    const allInputsInactive = this.checkAllInputsStateByGroup(this.device.group);

    if (allInputsInactive === this.currentState) {
      return;
    }

    if (this.setGpioState(allInputsInactive)) {
      this.service.updateCharacteristic(this.platform.Characteristic.On, allInputsInactive);
      this.currentState = allInputsInactive;
      this.platform.log.info(`GPIO ${this.device.pin} state changing to ${allInputsInactive}`);
    }
  }
}
