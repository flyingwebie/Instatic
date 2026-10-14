import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { TextAlignCenterIcon } from 'pixel-art-icons/icons/text-align-center'
import { TextAlignLeftIcon } from 'pixel-art-icons/icons/text-align-left'
import { TextAlignRightIcon } from 'pixel-art-icons/icons/text-align-right'
import { TextAlignJustifyIcon } from 'pixel-art-icons/icons/text-align-justify'
import { ColorsSwatchSolidIcon } from 'pixel-art-icons/icons/colors-swatch-solid'
import { PaintBucketSolidIcon } from 'pixel-art-icons/icons/paint-bucket-solid'
import { RulerDimensionSolidIcon } from 'pixel-art-icons/icons/ruler-dimension-solid'
import { ArrowsScaleIcon } from 'pixel-art-icons/icons/arrows-scale'
import { ArrowsHorizontalIcon } from 'pixel-art-icons/icons/arrows-horizontal'
import { ArrowsVerticalIcon } from 'pixel-art-icons/icons/arrows-vertical'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { BoldIcon } from 'pixel-art-icons/icons/bold'
import { ItalicIcon } from 'pixel-art-icons/icons/italic'
import { UnderlineIcon } from 'pixel-art-icons/icons/underline'
import { StrikeIcon } from 'pixel-art-icons/icons/strike'
import { Grid2x22SolidIcon } from 'pixel-art-icons/icons/grid-2x2-2-solid'
import { TextColumsIcon } from 'pixel-art-icons/icons/text-colums'
import { BulletlistSolidIcon } from 'pixel-art-icons/icons/bulletlist-solid'
import { HeadingIcon } from 'pixel-art-icons/icons/heading'
import { ContainerSolidIcon } from 'pixel-art-icons/icons/container-solid'
import { MonitorSolidIcon } from 'pixel-art-icons/icons/monitor-solid'
import { SmartphoneSolidIcon } from 'pixel-art-icons/icons/smartphone-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { EyeOffSolidIcon } from 'pixel-art-icons/icons/eye-off-solid'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'
import { ProportionsSolidIcon } from 'pixel-art-icons/icons/proportions-solid'
import { ArrowBarUpIcon } from 'pixel-art-icons/icons/arrow-bar-up'
import { ArrowBarDownIcon } from 'pixel-art-icons/icons/arrow-bar-down'
import { SlidersHorizontalIcon } from 'pixel-art-icons/icons/sliders-horizontal'
import { TextWrapIcon } from 'pixel-art-icons/icons/text-wrap'
import { EraserSolidIcon } from 'pixel-art-icons/icons/eraser-solid'
import { AlignCenterHorizontalSolidIcon } from 'pixel-art-icons/icons/align-center-horizontal-solid'

export const CSS_TOOLBAR_ICONS = {
  type: TextStartTIcon,
  alignment: TextAlignCenterIcon,
  left: TextAlignLeftIcon,
  right: TextAlignRightIcon,
  justify: TextAlignJustifyIcon,
  color: ColorsSwatchSolidIcon,
  effects: PaintBucketSolidIcon,
  spacing: RulerDimensionSolidIcon,
  size: ArrowsScaleIcon,
  horizontal: ArrowsHorizontalIcon,
  vertical: ArrowsVerticalIcon,
  layout: LayoutSolidIcon,
  position: MoveIcon,
  code: CodeIcon,
  bold: BoldIcon,
  italic: ItalicIcon,
  underline: UnderlineIcon,
  strike: StrikeIcon,
  grid: Grid2x22SolidIcon,
  columns: TextColumsIcon,
  rows: BulletlistSolidIcon,
  heading: HeadingIcon,
  container: ContainerSolidIcon,
  monitor: MonitorSolidIcon,
  phone: SmartphoneSolidIcon,
  visible: EyeSolidIcon,
  hidden: EyeOffSolidIcon,
  square: SquareSolidIcon,
  proportions: ProportionsSolidIcon,
  top: ArrowBarUpIcon,
  bottom: ArrowBarDownIcon,
  settings: SlidersHorizontalIcon,
  wrap: TextWrapIcon,
  clear: EraserSolidIcon,
  center: AlignCenterHorizontalSolidIcon,
}
export type CssToolbarIcon = keyof typeof CSS_TOOLBAR_ICONS
