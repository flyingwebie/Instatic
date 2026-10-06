import type { DbClient } from '../../../db/client'
import type { ApiCallFor } from '../../protocol/apiCallSchema'
import type { HostPluginRecord } from '../types'
import { replyApiOk } from '../apiReplies'
import {
  listPluginPublishedRoutes,
  renderPluginPublishedDocument,
} from '../../../publish/pluginPublication'
import { refreshPublishedHtml } from '../../../publish/refreshPublished'
import { assertHostPluginPermission, getPluginUploadsDir } from '../registry'

export async function handlePublicationList(
  msg: ApiCallFor<'cms.publication.list'>,
  _entry: HostPluginRecord,
  db: DbClient,
): Promise<void> {
  replyApiOk(
    msg.pluginId,
    msg.correlationId,
    await listPluginPublishedRoutes(db, msg.args[0]),
  )
}

export async function handlePublicationRender(
  msg: ApiCallFor<'cms.publication.render'>,
  _entry: HostPluginRecord,
  db: DbClient,
): Promise<void> {
  replyApiOk(
    msg.pluginId,
    msg.correlationId,
    await renderPluginPublishedDocument(db, msg.args[0]),
  )
}

export async function handlePublicationRefresh(
  msg: ApiCallFor<'cms.publication.refresh'>,
  entry: HostPluginRecord,
  db: DbClient,
): Promise<void> {
  assertHostPluginPermission(entry, 'cms.publication.read')
  replyApiOk(
    msg.pluginId,
    msg.correlationId,
    await refreshPublishedHtml(db, getPluginUploadsDir(), msg.args[0]),
  )
}
