/**
 * GPIO device configuration interface
 */
export interface GpioDevice {
    group: string;
    pin: number;
    direction: string;
    bcmPort: string;
    invertState: boolean;
    debounceMs: number;
  }

/**
   * Define two fixed GPIO input devices as contact sensors
   */
export const exampleDevices: GpioDevice[] = [
  {
    group: 'group1',
    pin: 538,
    direction: 'in',
    bcmPort: 'GPIO26',
    invertState: false,
    debounceMs: 250,
  },
  {
    group: 'group1',
    pin: 531,
    direction: 'in',
    bcmPort: 'GPIO19',
    invertState: false,
    debounceMs: 250,
  },
  {
    group: 'group1',
    pin: 525,
    direction: 'in',
    bcmPort: 'GPIO13',
    invertState: false,
    debounceMs: 250,
  },
  {
    group: 'group1',
    pin: 518,
    direction: 'in',
    bcmPort: 'GPIO6',
    invertState: false,
    debounceMs: 250,
  },
  {
    group: 'group1',
    pin: 517,
    direction: 'in',
    bcmPort: 'GPIO5',
    invertState: false,
    debounceMs: 250,
  },
  {
    group: 'group1',
    pin: 533,
    direction: 'out',
    bcmPort: 'GPIO21',
    invertState: false,
    debounceMs: 100,
  },
];