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
  private currentForceState: boolean = false;

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

    const pollingInverval = this.device.pollIntervalMs || 1000;
    this.setupPolling(pollingInverval, this.updateBasedOnInputs.bind(this));
  }

  getOn(callback: CharacteristicGetCallback): void {

    if (this.device.forceOutput) {
      this.platform.log.debug(`Get GPIO ${this.device.pin} current state=${this.currentForceState}`);
      callback(null, this.currentForceState);
    } else {
      const state = this.booleanToGpioValueWithInversion(this.currentState);
      this.service.updateCharacteristic(this.platform.Characteristic.On, state);
      this.platform.log.debug(`Get GPIO ${this.device.pin} state from cached value=${this.currentState},` +
      ` invertState=${this.device.invertState}, homekit=${state}`);
      callback(null, state);
    }
  }

  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback): void {

    if (this.device.forceOutput) {
    //   const state = value === true;
      const state = value as boolean;
      if (this.setGpioState(state)) {
        this.service.updateCharacteristic(this.platform.Characteristic.On, state);
        this.platform.log.info(`Toggled GPIO ${this.device.pin} to ${state ? 'ON' : 'OFF'}`);
        this.currentForceState = state;
      }
      callback();
    } else {
      callback(null);
      const state = this.booleanToGpioValueWithInversion(this.currentState);
      this.service.updateCharacteristic(this.platform.Characteristic.On, state);
      this.platform.log.debug(`Reverted UI state for GPIO ${this.device.pin}: logical=${this.currentState}, homekit=${state}`);
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
      const state = this.booleanToGpioValueWithInversion(allInputsInactive);
      this.service.updateCharacteristic(this.platform.Characteristic.On, state);
      this.platform.log.info(`GPIO ${this.device.pin} state changing to ${allInputsInactive} (inverted: ${this.device.invertState}, state: ${state})`);
      this.currentState = allInputsInactive;
    }
  }
}
