export default function SchoolIllustration() {
  return (
    <svg className="school-illustration" viewBox="0 0 430 330" fill="none" aria-hidden="true">
      <defs>
        <filter id="paper-shadow" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="#344887" floodOpacity=".13" />
        </filter>
        <pattern id="paper-grid" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M18 0H0V18" stroke="#e3e9f5" strokeWidth=".8" />
        </pattern>
      </defs>
      <circle cx="226" cy="172" r="130" fill="#DCE5FF" />
      <circle cx="226" cy="172" r="153" stroke="#CAD7F9" strokeDasharray="3 8" />
      <path d="M65 215c-20-7-30-25-19-31 14-8 37 17 24 40s-43 18-47 8" stroke="#9DADF0" strokeWidth="2" strokeLinecap="round" />
      <g transform="translate(107 65) rotate(-12 105 110)" filter="url(#paper-shadow)">
        <rect x="7" y="8" width="196" height="228" rx="12" fill="#5777EE" />
        <rect width="196" height="228" rx="12" fill="white" />
        <rect x="18" y="20" width="160" height="190" fill="url(#paper-grid)" />
        <path d="M33 0v228" stroke="#F0B8BF" strokeWidth="1.3" />
        <path d="M62 53h92M62 64h65" stroke="#ABB9D4" strokeWidth="4" strokeLinecap="round" />
        <text x="53" y="160" fill="#4263EB" fontFamily="Manrope Variable, sans-serif" fontSize="83" fontWeight="800" letterSpacing="-3">S</text>
        <path d="M58 173c28 7 64 5 90-3" stroke="#FFCA73" strokeWidth="7" strokeLinecap="round" />
        <g stroke="#677BAD" strokeWidth="4" strokeLinecap="round">
          <path d="M-6 33h17M-6 65h17M-6 97h17M-6 129h17M-6 161h17M-6 193h17" />
        </g>
      </g>
      <g transform="translate(290 155) rotate(19)" filter="url(#paper-shadow)">
        <rect width="22" height="124" rx="4" fill="#FFCE76" />
        <path d="M0 22h22" stroke="#EAA94E" strokeWidth="2" />
        <path d="M7 24v98" stroke="#FFE5B5" strokeWidth="5" />
        <path d="m0 124 11 27 11-27" fill="#E3C7A6" />
        <path d="m7 141 4 10 4-10" fill="#344567" />
        <path d="M0 4a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v13H0" fill="#F198AC" />
      </g>
      <g transform="translate(288 44) rotate(10 37 33)" filter="url(#paper-shadow)">
        <rect width="75" height="68" rx="17" fill="white" />
        <path d="m21 34 11 11 23-24" stroke="#669B88" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(72 249) rotate(-7)" filter="url(#paper-shadow)">
        <rect width="118" height="39" rx="19.5" fill="white" />
        <circle cx="22" cy="19.5" r="5" fill="#79A994" />
        <text x="36" y="24" fill="#56637D" fontFamily="DM Sans Variable, sans-serif" fontSize="12" fontWeight="600">Scool Tools</text>
      </g>
      <path d="m78 73 3-10 3 10 10 3-10 3-3 10-3-10-10-3 10-3Z" fill="#E8B667" />
      <path d="m352 209 3-8 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#8198E9" />
      <circle cx="354" cy="135" r="4" fill="#E8B667" />
      <circle cx="124" cy="32" r="4" fill="#8BA2E8" />
    </svg>
  );
}
