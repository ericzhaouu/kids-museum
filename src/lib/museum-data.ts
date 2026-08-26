import type { ExhibitionThemeId } from "@/lib/exhibition-themes";
import type { RoomArtworkDisplayConfig } from "@/lib/exhibition-curation";

export type ArtworkVisual =
  | "flying-whale"
  | "rainbow-city"
  | "moon-garden"
  | "family-table"
  | "blue-cat"
  | "paper-forest";

export type Artwork = {
  id: string;
  title: string;
  createdAt: string;
  age: string;
  medium: string;
  childQuote: string;
  description: string;
  visual?: ArtworkVisual;
  imageUrl?: string;
  hasAudio: boolean;
  audioUrl?: string;
  display?: RoomArtworkDisplayConfig;
};

export type StudioArtworkLike = {
  id: string;
  title: string;
  description: string;
  createdOn: string | null;
  createdOnLabel?: string;
  age: string;
  medium: string;
  status: string;
  visual?: string;
  previewUrl?: string;
  childQuote?: string;
  audio?: {
    status: "missing" | "ready";
    signedUrl?: string;
  };
};

export type GalleryRoom = {
  id: string;
  number: string;
  name: string;
  subtitle: string;
  introduction: string;
  artworks: Artwork[];
};

export type Exhibition = {
  title: string;
  subtitle: string;
  introduction: string;
  curatorNote: string;
  themeId?: ExhibitionThemeId;
  rooms: GalleryRoom[];
};

export const featuredExhibition: Exhibition = {
  title: "想象力有翅膀",
  subtitle: "兮爷的第一场线上画展",
  introduction:
    "这里收藏的不是标准答案，而是一个孩子看见世界时，突然冒出来的那些念头。",
  curatorNote: "第一辑 · 画作 6 件 · 私密家庭展",
  themeId: "warm-gallery",
  rooms: [
    {
      id: "sky-room",
      number: "01",
      name: "天上会发生什么",
      subtitle: "飞起来以后，一切都有了新的名字。",
      introduction:
        "鲸鱼可以离开海，城市也可以长出彩虹。这里没有不可能，只有还没有画出来。",
      artworks: [
        {
          id: "flying-whale",
          title: "飞过屋顶的鲸鱼",
          createdAt: "2025 年春",
          age: "5 岁 8 个月",
          medium: "水彩、蜡笔",
          childQuote: "它不是迷路了，它只是想看看我们住在哪里。",
          description:
            "一只鲸鱼从海面升起，穿过柔软的云和屋顶。蓝色不是海的边界，而是它旅行时带在身边的颜色。",
          visual: "flying-whale",
          hasAudio: false,
        },
        {
          id: "rainbow-city",
          title: "彩虹城市的早晨",
          createdAt: "2025 年夏",
          age: "5 岁 11 个月",
          medium: "马克笔、拼贴",
          childQuote: "每一家都可以选自己喜欢的天空。",
          description:
            "高高低低的房子挤在一起，却拥有各自不同的窗户。彩虹从城市背后升起，像一条通往早晨的路。",
          visual: "rainbow-city",
          hasAudio: false,
        },
        {
          id: "moon-garden",
          title: "月亮花园",
          createdAt: "2025 年秋",
          age: "6 岁 2 个月",
          medium: "油画棒",
          childQuote: "花在晚上也不睡觉，它们在听月亮讲话。",
          description:
            "月光落进花园，每一朵花都有自己的方向。夜晚在这里并不安静，而是一场只有植物听得见的谈话。",
          visual: "moon-garden",
          hasAudio: false,
        },
      ],
    },
    {
      id: "home-room",
      number: "02",
      name: "家是很多小事情",
      subtitle: "一张桌子、一只猫，还有纸做的森林。",
      introduction:
        "孩子记住的家，常常不是一间房子的样子，而是围在一起的人、熟悉的小动物和反复讲过的故事。",
      artworks: [
        {
          id: "family-table",
          title: "全家都在桌子边",
          createdAt: "2024 年冬",
          age: "5 岁 4 个月",
          medium: "彩铅",
          childQuote: "桌子要画得很大，因为大家都要坐下。",
          description:
            "画面中央是一张几乎占满纸面的桌子。人物从不同方向靠近，家的形状因此变成了一次围坐。",
          visual: "family-table",
          hasAudio: false,
        },
        {
          id: "blue-cat",
          title: "蓝猫的秘密",
          createdAt: "2025 年冬",
          age: "6 岁 4 个月",
          medium: "水粉",
          childQuote: "它白天是猫，晚上要帮星星排队。",
          description:
            "蓝色的小猫安静地坐着，尾巴却绕成了一条星星经过的路。它像是在等待一个只有夜晚才会开始的工作。",
          visual: "blue-cat",
          hasAudio: false,
        },
        {
          id: "paper-forest",
          title: "可以折起来的森林",
          createdAt: "2026 年春",
          age: "6 岁 7 个月",
          medium: "彩纸、贴纸",
          childQuote: "收起来的时候，树也会做梦。",
          description:
            "树木由一层层纸片搭成，打开时向外生长，合上时又回到一本小书里。森林拥有了可以带走的形状。",
          visual: "paper-forest",
          hasAudio: false,
        },
      ],
    },
  ],
};
