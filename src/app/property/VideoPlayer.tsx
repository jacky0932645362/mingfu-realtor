"use client";

/**
 * 影片播放器 —— 先放縮圖，點了才把 iframe 掛上去。
 *
 * 為什麼不直接放 iframe：一個 YouTube 播放器光是初始化就要拉幾百 KB 的
 * script 與樣式，一頁掛三支影片，手機在 4G 下開這頁會明顯卡住，
 * 而多數客戶只會看第一支。縮圖只有幾十 KB，滑到底也不痛。
 */

import { useState } from "react";
import styles from "./property.module.css";

export default function VideoPlayer({
  src,
  thumbUrl,
  title,
}: {
  src: string;
  thumbUrl: string;
  title: string;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className={styles.videoFrame}>
      {playing ? (
        <iframe
          src={`${src}&autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <button
          type="button"
          className={styles.videoPoster}
          onClick={() => setPlaying(true)}
          aria-label={`播放影片：${title}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbUrl} alt="" />
          <span className={styles.playBadge} aria-hidden="true">
            ▶
          </span>
        </button>
      )}
    </div>
  );
}
