export function detailToText(detail, t) {
  if (detail == null) return null
  if (typeof detail === 'string') return detail
  if (detail.code) return t(`errors.${detail.code}`, detail.params || detail)
  return null
}

export function apiErrorText(err, t) {
  return detailToText(err.response?.data?.detail, t) || err.message || t('common.unknownError')
}
