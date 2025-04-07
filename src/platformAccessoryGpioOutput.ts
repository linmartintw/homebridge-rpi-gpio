import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  type CharacteristicValue,
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
export class RpiPlatformAccessoryGpioOutput {
  private service: Service;
  private device: GpioDevice;
  private gpio: Gpio | null = null;
  private currentState: boolean = false;


  constructor(
    private readonly platform: RpiHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // Get the device information from accessory context
    this.device = accessory.context.device;

    const accessoryDisplayName = `${this.device.group}-${this.device.direction}-${this.device.bcmPort}`;

    // create Switch service
    this.service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessoryDisplayName);


    // set the handler of GET
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this))
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this));

    // set accessory information
    this.setupAccessoryInformation();

    // initialization Gpio
    if (this.initGpio()) {
      this.platform.log.info(`GPIO Switch initialized on pin ${this.device.pin}`);
    }

    // Setup Gpio shutdown hook
    this.platform.api.on('shutdown', () => {
      this.unexportGpio();
    });

  }

  getOn(callback: CharacteristicGetCallback):void {
    try {
      const value = this.gpio ? this.gpio.readSync() : undefined;

      let effectiveValue = value === 1;

      if (this.device.invertState) {
        effectiveValue = !effectiveValue;
      }

      this.platform.log.debug(`Read switch state for GPIO ${this.device.pin}: ${effectiveValue ? 'ON' : 'OFF'}`);
      this.currentState = effectiveValue;
      callback(null, this.currentState);

    } catch (error) {
      this.platform.log.error(`Error reading GPIO ${this.device.pin}:`, error);
      callback(null, false);
    }
  }

  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    try {
      if (!this.gpio) {
        this.platform.log.error(`GPIO ${this.device.pin} is not initialized`);
        callback(new Error(`GPIO ${this.device.pin} is not initialized`));
        return;
      }

      const boolValue = value as boolean;
      this.currentState = boolValue;

      let gpioValue = boolValue ? 1 : 0;
      if (this.device.invertState) {
        gpioValue = boolValue ? 0 : 1;
      }

      this.gpio.writeSync(gpioValue === 1 ? 1 : 0);
      this.platform.log.info(`Set GPIO ${this.device.pin} to ${boolValue ? 'ON' : 'OFF'} (GPIO value: ${gpioValue})`);
      callback(null);

    } catch (error) {
      this.platform.log.error(`Error reading GPIO ${this.device.pin}:`, error);
      callback(error as Error);
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

      // Create GPIO instance
      this.gpio = new Gpio(this.device.pin, this.device.direction as Direction);

      // read the first state and update state
      const initValue = this.gpio.readSync();
      let effectiveValue = initValue === 1;

      if (this.device.invertState) {
        effectiveValue = !effectiveValue;
      }

      this.currentState = effectiveValue;
      this.service.updateCharacteristic(this.platform.Characteristic.On, this.currentState);

      this.platform.log.debug(`GPIO ${this.device.pin} initialized with state: ${this.currentState ? 'ON' : 'OFF'}`);

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

}
