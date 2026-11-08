import fs from 'fs';
import {
  DatabaseStore,
  Thread,
  Message,
  Actions,
  AttachmentStore,
  SyncbackMetadataTask,
  QuotedHTMLTransformer,
  ComponentRegistry,
  DatabaseChangeRecord,
  AccountStore,
} from 'mailspring-exports';

import plugin from '../package.json';
import ThreadSharingButton from './thread-sharing-button';

export const PLUGIN_NAME = plugin.title;
export const PLUGIN_ID = plugin.name;

/** Self-hosted share backend, resolved per env the same way open-tracking resolves its URL. */
const PLUGIN_URL = plugin.serverUrl[AppEnv.config.get('env')];

const _readFile = Promise.promisify(fs.readFile);

/** Optional bearer for the share uploads; leave empty when the server runs without API_TOKEN. */
function shareAuthorization() {
  const token = AppEnv.config.get('core.sharing.apiToken') || process.env.NUNCIO_SHARING_TOKEN || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const _onDatabaseChange = (change: DatabaseChangeRecord<any>) => {
  if (change.type !== 'persist' || change.objectClass !== Thread.name) {
    return;
  }

  change.objects.forEach(async (thread) => {
    if (isShared(thread)) {
      syncThreadToWebSoon(thread);
    }
  });
};

export function isShared(thread: Thread) {
  const metadata = thread.metadataForPluginId(PLUGIN_ID) || {};
  return metadata.shared || false;
}

export function sharingURLForThread(thread: Thread) {
  const metadata = thread.metadataForPluginId(PLUGIN_ID) || {};
  if (!metadata || !metadata.key || !metadata.shared) {
    return null;
  }
  return `${PLUGIN_URL}/s/${encodeURIComponent(metadata.key)}`;
}

let soon = {};
let soonTimer = null;
const syncThreadToWebSoon = (thread: Thread) => {
  soon[thread.id] = thread;
  if (!soonTimer) {
    soonTimer = setTimeout(() => {
      const processing = Object.values(soon);
      soon = {};
      soonTimer = null;

      processing.forEach(async (thread: Thread) => {
        try {
          await syncThreadToWeb(thread);
        } catch (err) {
          console.warn(`Unable to sync thread '${thread.subject}' to the web: ${err}`);
        }
      });
    }, 5000);
  }
};

/** Uploads one attachment and answers with the link the web view can fetch it back on. */
async function uploadShareAsset(rel: string, data: Buffer): Promise<string> {
  const response = await fetch(`${PLUGIN_URL}/api/share/asset/${rel}`, {
    method: 'POST',
    headers: shareAuthorization(),
    // A Uint8Array (rather than a Blob with a guessed type) keeps uploads byte-exact.
    body: new Uint8Array(data),
  });
  if (!response.ok) {
    throw new Error(`Attachment upload failed (HTTP ${response.status})`);
  }
  return `${PLUGIN_URL}/s/a/${rel}`;
}

/** Upserts the thread payload; `{shared: false}` removes the shared page server-side. */
async function uploadSharePayload(key: string, payload: Record<string, unknown>) {
  const response = await fetch(`${PLUGIN_URL}/api/share/thread/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...shareAuthorization() },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(
      `Thread share upload failed (HTTP ${response.status}). Check the API token setting (core.sharing.apiToken).`
    );
  }
}

export const syncThreadToWeb = async (thread: Thread) => {
  const metadata = thread.metadataForPluginId(PLUGIN_ID) || {};

  let messages = await DatabaseStore.findAll<Message>(Message, { threadId: thread.id }).include(
    Message.attributes.body
  );

  // hide reminder notifications, deleted emails, etc.
  messages = messages.filter((m) => !m.isHidden());

  const combinedVersionHash = messages.map((m) => m.version).join('|');
  if (metadata.combinedVersionHash === combinedVersionHash) {
    // since thread sharing really just shows the messages in the thread, we don't need
    // to perform work (and could enter an infinite loop if we continue to update the metadata.)
    return;
  }

  // initialize, update the metadata value
  metadata.shared = true;
  metadata.combinedVersionHash = combinedVersionHash;
  metadata.key = metadata.key || `${thread.id}-${Date.now()}`;
  metadata.fileURLs = metadata.fileURLs || {};

  // first, sync any new attachments
  const files = messages.reduce((a, m) => a.concat(m.files), []);
  const toUpload = files.filter((f) => !metadata.fileURLs[f.id]);
  while (toUpload.length) {
    const file = toUpload.pop();
    try {
      const filePath = AttachmentStore.pathForFile(file);
      const data = await _readFile(filePath);
      if (data.length === 0) {
        throw new Error(`File ${filePath} is not on disk.`);
      }
      const rel = `${encodeURIComponent(file.id)}/${encodeURIComponent(file.displayName())}`;
      metadata.fileURLs[file.id] = await uploadShareAsset(rel, data);
    } catch (err) {
      console.log(`Could not upload attachment ${file.displayName()}: ${err}`);
    }
  }

  // The Reader is whoever owns the mail account; no Mailspring identity is involved any more.
  const me = AccountStore.accountForId(thread.accountId)?.me();
  const sharedBy = {
    firstName: me?.firstName || '',
    lastName: me?.lastName || '',
    emailAddress: me?.emailAddress || '',
  };

  // next, post the JSON for the entire thread
  await uploadSharePayload(metadata.key, {
    thread: thread,
    sharedBy: sharedBy,
    fileURLs: metadata.fileURLs,
    messages: messages.map((m) =>
      Object.assign({}, m.toJSON(), {
        body: QuotedHTMLTransformer.removeQuotedHTML(m.body, {
          keepIfWholeBodyIsQuote: true,
        }),
      })
    ),
  });

  Actions.queueTask(
    SyncbackMetadataTask.forSaving({
      model: thread,
      pluginId: PLUGIN_ID,
      value: metadata,
    })
  );
};

export const unsyncThread = async (thread: Thread) => {
  const metadata = thread.metadataForPluginId(PLUGIN_ID) || {};
  if (!metadata.key) return;
  await uploadSharePayload(metadata.key, { shared: false });

  Actions.queueTask(
    SyncbackMetadataTask.forSaving({
      model: thread,
      pluginId: PLUGIN_ID,
      value: { shared: false, key: metadata.key },
    })
  );
};
export function activate() {
  ComponentRegistry.register(ThreadSharingButton, {
    role: 'ThreadActionsToolbarButton',
  });
  this._unlisten = DatabaseStore.listen(_onDatabaseChange);
}

export function deactivate() {
  ComponentRegistry.unregister(ThreadSharingButton);
  if (this._unlisten) {
    this._unlisten();
    this._unlisten = null;
  }
}
