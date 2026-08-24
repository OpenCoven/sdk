import type {
  OperationContext,
  OperationOptions,
  PageOptions,
} from '@opencoven/sdk-core';

export interface CaveCanonicalFamiliar {
  id: string;
  name: string;
  repository: string;
  displayName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaveProject {
  id: string;
  name: string;
  familiarIds: readonly string[];
  repository: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaveConversation {
  id: string;
  familiarId: string;
  projectId?: string;
  title?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface CaveConversationDetail extends CaveConversation {
  metadata: Record<string, unknown>;
  branchId: string;
  headMessageId?: string;
  state: {
    activePath: readonly string[];
    currentVersion: number;
    baseVersion: number;
  };
}

export interface CaveMessage {
  id: string;
  parentId: string | null;
  type: string;
  content: string;
  createdAt: string;
  familiarId?: string;
  metadata?: Record<string, unknown>;
}

export type CaveCanonicalReadOptions = PageOptions & OperationOptions;

export interface CaveReadTransport {
  getJson(path: string, options?: OperationContext): Promise<unknown>;
}
