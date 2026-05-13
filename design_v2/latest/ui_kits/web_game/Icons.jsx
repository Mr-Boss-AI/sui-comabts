/* Icons.jsx — monoline 24x24 SVG icon set.
   All exposed on window so other modules can use them. */

const Icon = ({ children, size = 20, color = "currentColor", stroke = 2.2, fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
       strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ISword     = (p) => <Icon {...p}><path d="M5 19l4-4M14 4l6 6-9 9H5v-6z"/><path d="M16 6l2 2"/></Icon>;
const IShield    = (p) => <Icon {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></Icon>;
const IHelm      = (p) => <Icon {...p}><path d="M4 13c0-5 4-9 8-9s8 4 8 9v3H4z"/><path d="M9 16v3M15 16v3"/></Icon>;
const IChest     = (p) => <Icon {...p}><path d="M5 7l3-3h8l3 3v3l-2 1v9H7v-9L5 10z"/></Icon>;
const IGloves    = (p) => <Icon {...p}><path d="M7 4h3v8h4V4h3v15H7z"/></Icon>;
const IBoots     = (p) => <Icon {...p}><path d="M8 3h4v10h6v6H8z"/></Icon>;
const IBelt      = (p) => <Icon {...p}><rect x="3" y="9" width="18" height="6" rx="2"/><rect x="10" y="11" width="4" height="2"/></Icon>;
const IRing      = (p) => <Icon {...p}><circle cx="12" cy="14" r="6"/><path d="M9 7l3-4 3 4"/></Icon>;
const IAmulet    = (p) => <Icon {...p}><path d="M5 4l7 4 7-4"/><circle cx="12" cy="15" r="5"/></Icon>;
const IHeart     = (p) => <Icon {...p}><path d="M12 21s-7-5-7-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-7 11-7 11z"/></Icon>;
const IBolt      = (p) => <Icon {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></Icon>;
const ISpark     = (p) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8"/></Icon>;
const IShieldPlus= (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></Icon>;
const ICoin      = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7c-2 0-3 1-3 2.5S10 12 12 12s3 1 3 2.5S14 17 12 17"/><path d="M12 5v2M12 17v2"/></Icon>;
const ISwords    = (p) => <Icon {...p}><path d="M5 19l4-4M19 5l-9 9M5 5l7 7M14 14l5 5"/></Icon>;
const IStore     = (p) => <Icon {...p}><path d="M3 7h18l-2 12H5z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></Icon>;
const IMug       = (p) => <Icon {...p}><path d="M5 7h11v12H5z"/><path d="M16 9h3l1 2v4l-1 2h-3"/><path d="M7 4h7"/></Icon>;
const ITrophy    = (p) => <Icon {...p}><path d="M6 3h12v6a6 6 0 0 1-12 0z"/><path d="M18 5h3v3a3 3 0 0 1-3 3M6 5H3v3a3 3 0 0 0 3 3M9 21h6M12 16v5"/></Icon>;
const IUser      = (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 4-7 8-7s7 2 8 7"/></Icon>;
const IX         = (p) => <Icon {...p} stroke={p.color || "currentColor"}><path d="M5 5l14 14M19 5L5 19"/></Icon>;
const ICheck     = (p) => <Icon {...p} stroke="#5a8a3a"><path d="M4 12l5 5 11-12"/></Icon>;
const IChev      = (p) => <Icon {...p}><path d="M6 9l6 6 6-6"/></Icon>;
const IClock     = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Icon>;
const IPlus      = (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>;
const IInfo      = (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></Icon>;
const ISound     = (p) => <Icon {...p}><path d="M5 9v6h4l5 4V5L9 9z"/><path d="M17 8a6 6 0 0 1 0 8"/></Icon>;
const ISearch    = (p) => <Icon {...p}><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></Icon>;
const IFilter    = (p) => <Icon {...p}><path d="M4 5h16l-6 8v6l-4-2v-4z"/></Icon>;
const ILink      = (p) => <Icon {...p}><path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M14 12v6H4V8h6"/></Icon>;
const ICrown     = (p) => <Icon {...p}><path d="M3 18h18M3 18L5 7l4 4 3-7 3 7 4-4 2 11"/></Icon>;
const ISend      = (p) => <Icon {...p}><path d="M3 11l18-7-7 18-3-8z"/></Icon>;
const IDot       = (p) => <Icon {...p} fill={p.color || "#5a8a3a"} stroke="none"><circle cx="12" cy="12" r="5"/></Icon>;

Object.assign(window, {
  Icon,
  ISword, IShield, IHelm, IChest, IGloves, IBoots, IBelt, IRing, IAmulet,
  IHeart, IBolt, ISpark, IShieldPlus, ICoin, ISwords, IStore, IMug, ITrophy,
  IUser, IX, ICheck, IChev, IClock, IPlus, IInfo, ISound, ISearch, IFilter,
  ILink, ICrown, ISend, IDot,
});
