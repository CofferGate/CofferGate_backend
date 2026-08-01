import { Firestore } from "@google-cloud/firestore";
import type { AppConfig } from "../config.js";

export interface FirestoreDocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): unknown;
}

export interface FirestoreCollection {
  get(): Promise<{ readonly docs: readonly FirestoreDocumentSnapshot[] }>;
  doc(documentId: string): {
    get(): Promise<FirestoreDocumentSnapshot>;
  };
}

export interface FirestoreDatabase {
  collection(collectionPath: string): FirestoreCollection;
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
