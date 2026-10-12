
export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchInterval: number;
}

export const DEFAULT_SETTINGS: ProducerSettings = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchInterval: 500,
};
