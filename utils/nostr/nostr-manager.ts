import {
  SimplePool,
  Filter as NToolFilter,
  Event as NToolEvent,
  EventTemplate as NToolEvenTemplate,
  verifyEvent,
} from "nostr-tools";
import { SubscribeManyParams, SubCloser } from "nostr-tools/abstract-pool";

import { NostrNIP46Signer } from "@/utils/nostr/signers/nostr-nip46-signer";
import {
  ChallengeHandler,
  NostrSigner,
} from "@/utils/nostr/signers/nostr-signer";
import { NostrNSecSigner } from "@/utils/nostr/signers/nostr-nsec-signer";
import { NostrNIP07Signer } from "@/utils/nostr/signers/nostr-nip07-signer";
import { newPromiseWithTimeout } from "../timeout";
import { authenticateToRelay, authenticateToRelays } from "@/utils/nostr/nostr-helper-functions";

export type NostrRelay = {
  url: string;
  disconnect: () => Promise<void>;
  connect: () => Promise<void>;
  activeSubs: Array<NostrSub>;
  sleeping: boolean;
  lastActive: number;
  authenticated?: boolean;
};

export type NostrSub = {
  _sub: SubCloser;
  close: () => Promise<void>;
};

export type NostrFilter = NToolFilter;
export type NostrEvent = NToolEvent;
export type NostrEventTemplate = NToolEvenTemplate;
export type NostrManagerParams = {
  connectionTimeout?: number;
  keepAliveTime: number;
  gcInterval: number;
  readable?: boolean;
  writable?: boolean;
  autoAuth?: boolean;
};

export class NostrManager {
  private readonly pool: SimplePool;
  private readonly params: NostrManagerParams;
  private readonly relays: Array<NostrRelay> = [];
  private gcTimeout: any;
  private authenticatedRelays: Map<string, boolean> = new Map();

  constructor(relays: Array<string> = [], params?: NostrManagerParams) {
    const {
      keepAliveTime = 1000 * 60 * 5,
      gcInterval = 1000 * 60 * 5,
      connectionTimeout = undefined,
      readable = true,
      writable = true,
      autoAuth = false,
    } = params || {};

    this.pool = new SimplePool();
    this.params = {
      keepAliveTime,
      gcInterval,
      connectionTimeout,
      readable,
      writable,
      autoAuth,
    };
    for (const relay of relays) {
      this.addRelay(relay, { connectionTimeout: connectionTimeout });
    }
    this.gc().catch(console.error);
  }

  public static signerFrom(
    args: { [key: string]: string },
    challengeHandler: ChallengeHandler
  ): NostrSigner {
    const signer =
      NostrNIP07Signer.fromJSON(args, challengeHandler) ??
      NostrNSecSigner.fromJSON(args, challengeHandler) ??
      NostrNIP46Signer.fromJSON(args, challengeHandler);
    if (!signer) throw new Error("Invalid signer type " + JSON.stringify(args));
    return signer;
  }

  private keepAlive(relays: NostrRelay[]) {
    for (const relay of relays) {
      if (relay.sleeping) {
        try {
          relay.connect();
          relay.sleeping = false;
        } catch (e) {
          console.error(e);
        }
      }
      relay.lastActive = Date.now();
    }
  }

  private async gc() {
    try {
      for (const relay of this.relays) {
        if (
          !relay.sleeping &&
          relay.activeSubs.length === 0 &&
          Date.now() - relay.lastActive > this.params.keepAliveTime
        ) {
          try {
            await relay.disconnect();
          } catch (e) {
            console.error(e);
          }
          relay.sleeping = true;
        }
      }
    } catch (e) {
      console.error(e);
    }
    this.gcTimeout = setTimeout(() => {
      this.gc();
    }, this.params.keepAliveTime);
  }

  public async authenticateToRelay(signer: NostrSigner, relayUrl: string): Promise<boolean> {
    try {
      if (!this.relays.find(r => r.url === relayUrl)) {
        this.addRelay(relayUrl);
      }

      const relay = await this.pool.ensureRelay(relayUrl);
      const result = await authenticateToRelay(signer, relay, relayUrl);
      this.authenticatedRelays.set(relayUrl, result);

      const relayObj = this.relays.find(r => r.url === relayUrl);
      if (relayObj) {
        relayObj.authenticated = result;
      }

      if (result) {
        console.info(`✅ NIP-42 Auth successful for ${relayUrl}`);
      } else {
        console.warn(`❌ NIP-42 Auth failed for ${relayUrl}`);
      }

      return result;
    } catch (error) {
      console.error(`❌ NIP-42 Auth error for ${relayUrl}:`, error);
      return false;
    }
  }

  public isRelayAuthenticated(relayUrl: string): boolean {
    return this.authenticatedRelays.get(relayUrl) === true;
  }

  public async subscribe(
    filters: NostrFilter[],
    params: SubscribeManyParams,
    relayUrls?: string[]
  ): Promise<NostrSub> {
    if (!this.params.readable) throw new Error("not readable");

    if (params?.onevent) {
      const onevent = params.onevent;
      params.onevent = (event: NostrEvent) => {
        if (verifyEvent(event)) {
          onevent(event);
        }
      };
    }
    if (relayUrls) {
      for (const relayUrl of relayUrls) {
        this.addRelay(relayUrl);
      }
    }

    const relays = relayUrls
      ? this.relays.filter((r) => relayUrls.includes(r.url))
      : this.relays;
    const sub: NostrSub = {
      _sub: this.pool.subscribeMany(
        relays.map((r) => r.url),
        filters,
        params ?? {}
      ),
      close: async () => {
        sub._sub.close();
        for (const relay of relays) {
          const activeSubs = relay.activeSubs;
          const i = activeSubs.indexOf(sub);
          if (i !== -1) activeSubs.splice(i, 1);
        }
      },
    };
    for (const relay of relays) {
      relay.activeSubs.push(sub);
    }
    this.keepAlive(relays);
    return sub;
  }

  public async fetch(
    filters: NostrFilter[],
    params?: SubscribeManyParams,
    relayUrls?: string[]
  ): Promise<NostrEvent[]> {
    return await newPromiseWithTimeout(async (resolve, _reject) => {
      if (!params) {
        params = {};
      }

      if (!params.onevent) {
        params.onevent = () => { };
      }

      if (!params.oneose) {
        params.oneose = () => { };
      }

      const onEvent = params.onevent;
      const onEose = params.oneose;
      const fetchedEvents: Array<NostrEvent> = [];

      params.onevent = (event: NostrEvent) => {
        fetchedEvents.push(event);
        return onEvent!(event);
      };

      params.oneose = () => {
        sub!.close();
        resolve(fetchedEvents);
        return onEose!();
      };

      const sub = await this.subscribe(filters, params, relayUrls);
    });
  }

  // Authenticate to relay if autoAuth is enabled and publish event
  public async publish(
    event: NostrEvent,
    relayUrls?: string[],
    signer?: NostrSigner
  ): Promise<void> {
    if (!this.params.writable) throw new Error("not writable");
    if (relayUrls) {
      for (const relayUrl of relayUrls) {
        this.addRelay(relayUrl);
      }
    }

    const relays = relayUrls
      ? this.relays.filter((r) => relayUrls.includes(r.url))
      : this.relays;
    this.keepAlive(relays);

    if (this.params.autoAuth && signer) {
      for (const relay of relays) {
        if (!relay.authenticated) {
          try {
            const result = await this.authenticateToRelay(signer, relay.url);
            if (!result) {
              console.warn(`Publishing to ${relay.url} without authentication`);
            }
          } catch (error) {
            console.warn(`Failed to authenticate to ${relay.url}, publishing anyway`);
          }
        }
      }
    }

    await Promise.allSettled(
      this.pool.publish(
        relays.map((r) => r.url),
        event
      )
    );
  }

  public addRelay(
    relayUrl: string,
    params?: {
      connectionTimeout?: number;
    }
  ): void {
    if (this.relays.find((r) => r.url === relayUrl)) return;
    const r = this.pool.ensureRelay(relayUrl, params);
    const relay: NostrRelay = {
      url: relayUrl,
      connect: async () => {
        this.pool.ensureRelay(relayUrl, params);
        await (await r).connect();
      },
      disconnect: async () => {
        (await r).close();
      },
      activeSubs: [],
      sleeping: true,
      lastActive: Date.now(),
      authenticated: false,
    };
    this.relays.push(relay);
  }

  public addRelays(
    relayUrls: string[],
    params?: {
      connectionTimeout?: number;
    }
  ): void {
    for (const relayUrl of relayUrls) {
      this.addRelay(relayUrl, params);
    }
  }

  public async authenticateToRelays(
    signer: NostrSigner,
    relayUrls?: string[]
  ): Promise<Map<string, boolean>> {
    if (!relayUrls || relayUrls.length === 0) {
      relayUrls = this.relays.map(r => r.url);
    }

    console.info(`🔑 Attempting NIP-42 authentication for ${relayUrls.length} relay(s)...`);
    const results = await authenticateToRelays(this, signer, relayUrls);

    let successCount = 0;
    for (const [url, result] of results.entries()) {
      if (result) successCount++;
      this.authenticatedRelays.set(url, result);
      const relayObj = this.relays.find(r => r.url === url);
      if (relayObj) {
        relayObj.authenticated = result;
      }
    }

    console.info(`✅ NIP-42 Auth complete: ${successCount}/${relayUrls.length} successful`);
    return results;
  }

  public close() {
    clearTimeout(this.gcTimeout);
    this.authenticatedRelays.clear();
    for (const relay of this.relays) {
      for (const sub of [...relay.activeSubs]) {
        sub.close();
      }
      relay.disconnect();
    }
    this.relays.length = 0;
  }
}
