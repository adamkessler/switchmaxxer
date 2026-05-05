import type { RecordObservationBatchItem } from "./service";

export interface GatewayObservationWriterInitMessage {
  type: "init";
  dbPath: string;
}

export interface GatewayObservationWriterWriteBatchMessage {
  type: "write_batch";
  sequence: number;
  batch: RecordObservationBatchItem[];
}

export interface GatewayObservationWriterCloseMessage {
  type: "close";
}

export type GatewayObservationWriterRequestMessage =
  | GatewayObservationWriterInitMessage
  | GatewayObservationWriterWriteBatchMessage
  | GatewayObservationWriterCloseMessage;

export interface GatewayObservationWriterReadyMessage {
  type: "ready";
}

export interface GatewayObservationWriterBatchWrittenMessage {
  type: "batch_written";
  sequence: number;
  durationMs: number;
  droppedCount: number;
  warnings: string[];
}

export interface GatewayObservationWriterFatalMessage {
  type: "fatal";
  message: string;
}

export interface GatewayObservationWriterClosedMessage {
  type: "closed";
}

export type GatewayObservationWriterResponseMessage =
  | GatewayObservationWriterReadyMessage
  | GatewayObservationWriterBatchWrittenMessage
  | GatewayObservationWriterFatalMessage
  | GatewayObservationWriterClosedMessage;
