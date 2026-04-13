import type { MutableRefObject } from "react";

import type { FetchMode, MultipleAccount, PrivateType } from "@/types/fetch";
import { runMultiFetchSession } from "@/lib/fetch/runMultiFetchSession";

interface SeedMultiFetchAccountsOptions {
  requestedAccounts: MultipleAccount[];
  queueMode: FetchMode;
  queuePrivateType: PrivateType;
  queueMediaType: string;
  queueRetweets: boolean;
  timeoutSeconds: number;
}

interface RunMultiFetchQueueOptions extends SeedMultiFetchAccountsOptions {
  resolvedAuthToken: string;
  batchSize: number;
  concurrency: number;
  stopAllRef: MutableRefObject<boolean>;
  accountStartTimesRef: MutableRefObject<Map<string, number>>;
  accountStopFlagsRef: MutableRefObject<Map<string, boolean>>;
  accountMediaCountRef: MutableRefObject<Map<string, number>>;
  accountTimeoutSecondsRef: MutableRefObject<Map<string, number>>;
  activeAccountRequestIdsRef: MutableRefObject<Map<string, string>>;
  setMultipleAccountsState: (
    value:
      | MultipleAccount[]
      | ((previous: MultipleAccount[]) => MultipleAccount[])
  ) => void;
  queueMultipleAccountUpdate: (
    accountId: string,
    patch: Partial<MultipleAccount>
  ) => void;
  flushMultipleAccountUpdates: () => void;
  clearAccountRuntimeState: (accountId: string) => void;
  markAccountDiffVisible: (accountId: string) => void;
}

export function seedMultiFetchAccounts({
  requestedAccounts,
  queueMode,
  queuePrivateType,
  queueMediaType,
  queueRetweets,
  timeoutSeconds,
}: SeedMultiFetchAccountsOptions): MultipleAccount[] {
  return requestedAccounts.map((account) => ({
    ...account,
    mode: account.mode ?? queueMode,
    privateType: account.privateType ?? queuePrivateType,
    mediaType: account.mediaType ?? queueMediaType,
    retweets: account.retweets ?? queueRetweets,
    status: "pending" as const,
    mediaCount: 0,
    previousMediaCount: 0,
    elapsedTime: 0,
    remainingTime: timeoutSeconds,
    error: undefined,
    showDiff: false,
  }));
}

export async function runMultiFetchQueue({
  requestedAccounts,
  queueMode,
  queuePrivateType,
  queueMediaType,
  queueRetweets,
  timeoutSeconds,
  resolvedAuthToken,
  batchSize,
  concurrency,
  stopAllRef,
  accountStartTimesRef,
  accountStopFlagsRef,
  accountMediaCountRef,
  accountTimeoutSecondsRef,
  activeAccountRequestIdsRef,
  setMultipleAccountsState,
  queueMultipleAccountUpdate,
  flushMultipleAccountUpdates,
  clearAccountRuntimeState,
  markAccountDiffVisible,
}: RunMultiFetchQueueOptions) {
  const seededAccounts = seedMultiFetchAccounts({
    requestedAccounts,
    queueMode,
    queuePrivateType,
    queueMediaType,
    queueRetweets,
    timeoutSeconds,
  });

  setMultipleAccountsState(seededAccounts);

  let nextAccountIndex = 0;

  const getNextAccount = () => {
    if (stopAllRef.current) {
      return null;
    }

    const account = seededAccounts[nextAccountIndex];
    nextAccountIndex += 1;
    return account || null;
  };

  const worker = async () => {
    while (!stopAllRef.current) {
      const account = getNextAccount();
      if (!account) {
        return;
      }

      await runMultiFetchSession({
        account,
        queueMode,
        queuePrivateType,
        queueMediaType,
        queueRetweets,
        resolvedAuthToken,
        timeoutSeconds,
        batchSize,
        stopAllRef,
        accountStartTimesRef,
        accountStopFlagsRef,
        accountMediaCountRef,
        accountTimeoutSecondsRef,
        activeAccountRequestIdsRef,
        queueMultipleAccountUpdate,
        flushMultipleAccountUpdates,
        clearAccountRuntimeState,
        markAccountDiffVisible,
      });
    }
  };

  const workerCount = Math.min(concurrency, seededAccounts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    seededAccounts,
    completed: !stopAllRef.current,
  };
}
