/**
 * ViewerBody — picks the right viewer for an asset's MIME type.
 *
 *   image/*  → ImageViewer
 *   video/*  → VideoViewer
 *   audio/*  → AudioViewer
 *   anything else → FallbackViewer
 *
 * Audio dispatches on the MIME prefix rather than on `bucketForMime`, which
 * answers the coarser question the grid and the picker ask (is this a picture
 * or not). Documents and archives stay with the fallback on purpose: they are
 * served as downloads, so there is nothing to render in place.
 *
 * The dispatcher lives in one file so adding a new viewer type later is a
 * single edit here.
 */
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import { bucketForMime } from '../../utils/filters'
import { ImageViewer } from './ImageViewer'
import { VideoViewer } from './VideoViewer'
import { AudioViewer } from './AudioViewer'
import { FallbackViewer } from './FallbackViewer'

interface ViewerBodyProps {
  asset: CmsMediaAsset
}

export function ViewerBody({ asset }: ViewerBodyProps) {
  const bucket = bucketForMime(asset.mimeType)
  if (bucket === 'image') {
    return <ImageViewer asset={asset} />
  }
  if (bucket === 'video') {
    return <VideoViewer src={asset.publicPath} />
  }
  if (asset.mimeType.startsWith('audio/')) {
    return <AudioViewer src={asset.publicPath} />
  }
  return (
    <FallbackViewer
      publicPath={asset.publicPath}
      filename={asset.filename}
      mimeType={asset.mimeType}
    />
  )
}
