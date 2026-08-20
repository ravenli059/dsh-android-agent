/**
 * Unobtrusive helpers for turning a getUI accessibility tree into actions:
 * flatten, find by text/resourceId, pick a clickable target and compute the
 * tap center. Pure functions — no I/O, unit-testable.
 */

/** One node of the accessibility tree as emitted by the phone agent. */
export interface UiNode {
  class?: string
  package?: string
  text?: string
  contentDescription?: string
  resourceId?: string
  bounds: { left: number; top: number; right: number; bottom: number }
  clickable?: boolean
  scrollable?: boolean
  checked?: boolean
  selected?: boolean
  focusable?: boolean
  focused?: boolean
  enabled?: boolean
  visible?: boolean
  actions?: number[]
  children?: UiNode[]
}

/** Flatten the tree into a list (children first, then their subtree). */
export function flatten(root: UiNode | null | undefined): UiNode[] {
  if (root === undefined || root === null) return []
  const out: UiNode[] = []
  const walk = (node: UiNode): void => {
    out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return out
}

/** Search options — at least one filter should be set. */
export interface FindOptions {
  /** Match text or contentDescription containing this value (case-insensitive). */
  contains?: string
  /** Exact resourceId (or suffix match when ends with the value). */
  resourceId?: string
  /** Only return nodes inside these bounds (screen rect), e.g. pick a panel. */
  inside?: { left: number; top: number; right: number; bottom: number }
}

/** Return matching, visible nodes in tree order. */
export function findNodes(root: UiNode | null | undefined, options: FindOptions): UiNode[] {
  const list = flatten(root)
  const want = (s: string | undefined): boolean => s !== undefined && s.trim() !== ''
  const text = options.contains?.trim()
  const rid = options.resourceId?.trim()
  const hasAnyFilter = want(text) || want(rid)
  const matches = list.filter(node => {
    if (hasAnyFilter) {
      const textHit = want(text)
        ? (node.text ?? '').toLowerCase().includes(text!.toLowerCase()) ||
          (node.contentDescription ?? '').toLowerCase().includes(text!.toLowerCase())
        : true
      const ridHit = want(rid)
        ? ((node.resourceId ?? '') === rid || (node.resourceId ?? '').endsWith('/' + rid))
        : true
      if (!textHit || !ridHit) return false
    }
    if (node.visible === false) return false
    if (options.inside !== undefined) {
      const b = node.bounds
      if (b.right < options.inside.left || b.left > options.inside.right || b.bottom < options.inside.top || b.top > options.inside.bottom) return false
    }
    return true
  })
  return matches
}

/** Center point of a node's bounds (for tap). */
export function center(node: UiNode): { x: number; y: number } {
  const b = node.bounds
  return {
    x: Math.round((b.left + b.right) / 2),
    y: Math.round((b.top + b.bottom) / 2),
  }
}

/**
 * Pick the best node to tap for a matched set: first clickable node, otherwise
 * the first enabled visible node (its center is still a safe guess).
 */
export function pickTapTarget(nodes: UiNode[]): UiNode | undefined {
  return nodes.find(n => n.clickable === true && n.enabled !== false)
    ?? nodes.find(n => n.enabled !== false)
}

/** Shape of the finder output used by phone_ui_find / phone_ui_tap. */
export interface NodeDescription {
  index: number
  text?: string
  contentDescription?: string
  resourceId?: string
  class?: string
  clickable?: boolean
  enabled?: boolean
  bounds?: { left: number; top: number; right: number; bottom: number }
  center?: { x: number; y: number }
}

/** Short one-line description of a node (for the agent/tool output). */
export function describeNode(node: UiNode, index: number): NodeDescription {
  const b = node.bounds
  return {
    index,
    text: node.text ?? '',
    contentDescription: node.contentDescription ?? '',
    resourceId: node.resourceId ?? '',
    class: node.class ?? '',
    clickable: node.clickable === true,
    enabled: node.enabled !== false,
    bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
    center: center(node),
  }
}
