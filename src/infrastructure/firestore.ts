import { Firestore } from "@google-cloud/firestore";
import type { AppConfig } from "../config.js";

export interface FirestoreDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): unknown;
}

export interface FirestoreDocumentReference {
  readonly id: string;
  get(): Promise<FirestoreDocumentSnapshot>;
}

export interface FirestoreTransaction {
  get(reference: FirestoreDocumentReference): Promise<FirestoreDocumentSnapshot>;
  set(reference: FirestoreDocumentReference, data: unknown): void;
}

export interface FirestoreCollection {
  get(): Promise<{ readonly docs: readonly FirestoreDocumentSnapshot[] }>;
  doc(documentId: string): FirestoreDocumentReference;
}

export interface FirestoreDatabase {
  collection(collectionPath: string): FirestoreCollection;
  runTransaction<Result>(
    operation: (transaction: FirestoreTransaction) => Promise<Result>,
  ): Promise<Result>;
}

export function createFirestoreDatabase(config: AppConfig): Firestore {
  const settings = config.GOOGLE_CLOUD_PROJECT
    ? {
        projectId: config.GOOGLE_CLOUD_PROJECT,
        databaseId: config.FIRESTORE_DATABASE_ID,
      }
    : { databaseId: config.FIRESTORE_DATABASE_ID };

  return new Firestore(settings);
}
