declare module "sherpa-onnx-node" {
  export type OfflineStream = {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  };

  export class OfflineRecognizer {
    static createAsync(config: object): Promise<OfflineRecognizer>;
    createStream(): OfflineStream;
    decodeAsync(stream: OfflineStream): Promise<{ text: string }>;
  }

  export class OfflineTts {
    static createAsync(config: object): Promise<OfflineTts>;
    generateAsync(input: {
      text: string;
      sid: number;
      speed: number;
    }): Promise<{ samples: Float32Array; sampleRate: number }>;
  }
}
