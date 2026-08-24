/** 依國家自動帶入電話號碼顯示格式（僅視覺分隔用，實際比對在後端 canonicalize_phone() 會去掉所有非數字字元）。
 * TW 手機：4-3-3（0912-345-678，10 碼）
 * JP 手機：3-4-4（090-1234-5678，11 碼） */
export function formatPhoneInput(country, value) {
  const digits = value.replace(/\D/g, '')
  if (country === 'JP') {
    const d = digits.slice(0, 11)
    return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)].filter(Boolean).join('-')
  }
  const d = digits.slice(0, 10)
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7, 10)].filter(Boolean).join('-')
}

export function phonePlaceholder(country) {
  return country === 'JP' ? '090-1234-5678' : '0912-345-678'
}
