import type { Logging, PlatformAccessory, Service } from 'homebridge';
import { Gpio } from 'onoff';
import type { RpiHomebridgePlatform } from './rpiPlatform.js';

/**
 * GPIO device configuration interface
 */
export interface GpioDevice {
  name?: string;
  group: string;
  pin: number;
  direction: string;
  bcmPort: string;
  invertState: boolean;
  debounceMs: number;
  pollIntervalMs?: number;
  forceOutput?: boolean;
}

/**
 * Base class for GPIO accessories containing common functionality
 */
export abstract class GpioBase {
  protected device: GpioDevice;
  protected service: Service;
  protected gpio: Gpio | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(
    protected readonly platform: RpiHomebridgePlatform,
    protected readonly accessory: PlatformAccessory,
    serviceType: any,
  ) {
    // Get the device information from accessory context
    this.device = accessory.context.device;

    const accessoryDisplayName = this.device.name
      ? `${this.device.group}-${this.device.name}`
      : `${this.device.group}-${this.device.direction}-${this.device.bcmPort}`;

    // Create service based on the provided service type
    this.service = this.accessory.getService(serviceType) ||
      this.accessory.addService(serviceType);

    // Set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessoryDisplayName);

    // Set accessory information
    this.setupAccessoryInformation();

    this.setupServiceHandling();

    if (this.initGpio()) {
      this.onGpioInitialized();
    }

    // Setup Gpio shutdown hook
    this.platform.api.on('shutdown', () => {
      this.unexportGpio();
    });
  }

  protected abstract setupServiceHandling(): void;

  protected abstract onGpioInitialized(): void;

   /**
   * Initialize GPIO - should be implemented by child classes
   */
   protected abstract initGpio(): boolean;
   /**
   * Setup accessory information
   */
   protected setupAccessoryInformation(): void {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');
   }

   /**
   * Clean up and release GPIO resources
   */
   protected async unexportGpio(): Promise<void> {
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

   /**
   * Apply inversion based on device config
   * @param value Value to potentially invert
   * @returns Inverted or original value based on device config
   */
   protected applyInversion(value: number): number {
     return this.device.invertState ? (value === 1 ? 0 : 1) : value;
   }

   /**
   * Convert boolean to GPIO value (0 or 1) with inversion logic
   * @param value Boolean value
   * @returns GPIO value (0 or 1) with inversion applied
   */
   protected booleanToGpioValueWithInversion(value: boolean): number {
     const gpioValue = value ? 1 : 0;
     return this.applyInversion(gpioValue);
   }

   /**
   * Convert GPIO value (0 or 1) to boolean with inversion logic
   * @param value GPIO value (0 or 1)
   * @returns Boolean value with inversion applied
   */
   protected gpioValueToBooleanWithInversion(value: number): boolean {
     const gpioValue = this.applyInversion(value);
     return gpioValue === 1;
   }

   protected checkAllInputsState():boolean {
     if (!this.platform.gpioStateManager) {
       this.platform.log.warn('GPIO State Manager not available');
       return false;
     }

     const allInputStates = this.platform.gpioStateManager.getAllStateGpioInput();

     if (allInputStates.length === 0) {
       this.platform.log.debug('No Gpio Inputs found');
       return false;
     }

     const allInactive = allInputStates.every(input => input.state === false);

     this.platform.log.debug(`All GPIO inputs state check: ${allInactive}`);
     return allInactive;
   }

   protected checkAllInputsStateByGroup(group: string): boolean {
     const allInputStates = this.platform.gpioStateManager.getAllStateGpioInput().filter(input => input.group === group);

     if (allInputStates.length === 0) {
       this.platform.log.debug(`No inputs found for group: ${group}`);
       return false;
     }

     //  change condition from AND-gate to OR-gate
     //  const allInactive = allInputStates.every(input => input.state === false);
     const allInactive = allInputStates.every(input => input.state === true);

     this.platform.log.debug(`All GPIO inputs state check for ${group} ${allInactive}`);
     return allInactive;
   }

   protected updateBasedOnInputs(): void {}

   protected readCurrentGpioState(): boolean | undefined {
     try {
       if (!this.gpio) {
         this.platform.log.warn(`GPIO ${this.device.pin} is not initialized`);
         return undefined;
       }

       const value = this.gpio.readSync();
       const effectiveValue = this.gpioValueToBooleanWithInversion(value);

       this.platform.log.debug(`Read GPIO ${this.device.pin} state: ${effectiveValue ? 'ON' : 'OFF'}`);
       return effectiveValue;
     } catch (error) {
       this.platform.log.error(`Error reading GPIO ${this.device.pin}:`, error);
       return false;
     }
   }

   protected setGpioState(state: boolean): boolean {
     try {
       if (!this.gpio) {
         this.platform.log.error(`GPIO ${this.device.pin} is not initialized`);
         return false;
       }

       const gpioValue = this.booleanToGpioValueWithInversion(state);
       this.gpio.writeSync(gpioValue ? 1 : 0);

       this.platform.log.debug(`Setting GPIO ${this.device.pin}: requested state=${state},` +
        ` inverted=${this.device.invertState}, actual GPIO value=${gpioValue}`);

       return true;
     } catch (error) {
       this.platform.log.error(`Error setting GPIO ${this.device.pin}:`, error);
       return false;
     }
   }

   protected setupPolling(interval: number, callback: () => void): void {
     this.clearPolling();
     this.platform.log.debug(`Setting up polling for GPIO ${this.device.pin} with interval ${interval}ms`);
     this.pollingInterval = setInterval(callback, interval);
     this.platform.api.on('shutdown', () => {
       this.clearPolling();
     });
   }

   protected clearPolling(): void {
     if (this.pollingInterval) {
       clearInterval(this.pollingInterval);
       this.pollingInterval = null;

     }
   }

}

/**
 * Class for tracking GPIO states
 */
export class GpioStateManager {
  private stateGpioInput: Array<{
    group?: string;
    pin: number;
    state: boolean;
    lastUpdated: number;
  }> = [];

  private pinToGroupMap: Map<number, string> = new Map();


  constructor(
    private readonly log: Logging,
  ) {}

  public registerPinToGroup(pin: number, group: string): void {
    this.pinToGroupMap.set(pin, group);
    this.log.debug(`Registered pin ${pin} to group ${group}`);
  }

  public getGroupForPin(pin: number): string | undefined {
    return this.pinToGroupMap.get(pin);
  }

  /**
   * Update the state of a GPIO input
   * @param pin GPIO pin number
   * @param state Boolean state value
   */
  public updateStateGpioInput(pin: number, state: boolean): void {
    const existingIndex = this.stateGpioInput.findIndex(item => item.pin === pin);
    const now = Date.now();
    const group = this.getGroupForPin(pin);

    if (existingIndex >= 0) {
      this.stateGpioInput[existingIndex] = {
        group,
        pin,
        state,
        lastUpdated: now,
      };
    } else {
      this.stateGpioInput.push({
        group,
        pin,
        state,
        lastUpdated: now,
      });
    }

    this.log.debug(`Updated GPIO input state: ${group} pin ${pin} = ${state ? 'CONTACT_DETECTED' : 'CONTACT_NOT_DETECTED'}`);
  }



  /**
   * Get the state of a GPIO input
   * @param pin GPIO pin number
   * @returns State of the GPIO input (undefined if not found)
   */
  public getStateGpioInput(pin: number): boolean | undefined {
    const record = this.stateGpioInput.find(item => item.pin === pin);
    return record ? record.state : undefined;
  }

  /**
   * Get all GPIO input states
   * @returns Array of all GPIO input states
   */
  public getAllStateGpioInput(): Array<{group?: string, pin: number; state: boolean; lastUpdated: number}> {
    return [...this.stateGpioInput];
  }

  /**
   * Display all GPIO states in a formatted table
   */
  public displayAllGpioStates(): void {
    const states = this.getAllStateGpioInput();

    if (states.length === 0) {
      this.log.info('No GPIO states recorded yet.');
      return;
    }

    // Create a clear table-like output
    const timestamp = new Date().toLocaleTimeString();
    console.log('\n----- GPIO States at ' + timestamp + ' -----');

    // Header
    console.log('Group\tPin\tState\t\t\tLast Updated');
    console.log('-----\t---\t-----\t\t\t------------');

    // State data
    for (const record of states) {
      const group = record.group || 'N/A';
      const stateText = record.state ? 'CONTACT_DETECTED' : 'CONTACT_NOT_DETECTED';
      const lastUpdated = new Date(record.lastUpdated).toLocaleTimeString();
      console.log(`${group}\t${record.pin}\t${stateText}\t${lastUpdated}`);
    }

    console.log('-------------------------------------\n');
  }
}