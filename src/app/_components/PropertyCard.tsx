"use client";

/**
 * 物件卡片（2026-09-01）
 *
 * 首頁「物件精選」與 /property 列表共用同一張卡片 —— 兩邊各寫一份的話，
 * 改了首頁忘了改列表，客戶會在同一個站看到兩種卡片。
 *
 * 為什麼要 "use client"：照片輪播要記住「現在第幾張」，那是瀏覽器端的狀態。
 * 卡片其餘部分其實不需要 JS，但輪播沒辦法純 CSS 做到「上一張／下一張／指示點」
 * 三種操作都對，所以整張卡一起下放到 client。
 *
 * 沒有照片時不顯示空框，改顯示「照片整理中」——空白框看起來像壞掉。
 *
 * ⚠️ 卡片上的按鈕只有三顆，不要再加。這是客戶在列表頁的決策點：
 *    看細節（物件資訊）／看影片（影片賞析）／直接約（預約看屋）。
 *    再多一顆就變成選擇障礙，反而沒人按。
 */

import { useState } from "react";
import Link from "next/link";
import type { PropertyCardData } from "./property-card-data";
import styles from "./PropertyCard.module.css";

const ARROW_LEFT = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M15 5 L8 12 L15 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ARROW_RIGHT = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 5 L16 12 L9 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 賣點前面的小菱形。用 SVG 不用 emoji —— emoji 在不同手機長得不一樣。 */
const BULLET = (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={styles.bullet}>
    <path d="M8 2 L11 8 L8 14 L5 8 Z" fill="currentColor" />
  </svg>
);

export default function PropertyCard({ data }: { data: PropertyCardData }) {
  const { photos } = data;
  const [index, setIndex] = useState(0);
  const total = photos.length;
  const multi = total > 1;

  /* 頭尾相接：看到最後一張再按「下一張」回到第一張。
     客戶在手機上是連續點的，走到底突然沒反應會以為卡住了。 */
  function go(step: number) {
    setIndex((i) => (i + step + total) % total);
  }

  const detailUrl = `/property/${data.slug}`;

  return (
    <article className={styles.card}>
      <div className={styles.cover}>
        {total > 0 ? (
          <>
            {photos.map((src, i) => (
              /* 用「網址＋位置」當 key：資料層雖然已經去重，但這個元件是公開介面，
                 呼叫端硬塞重複網址進來時不該整組照片壞掉。 */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={`${src}-${i}`}
                src={src}
                alt={i === 0 ? data.title : `${data.title}（照片 ${i + 1}）`}
                className={i === index ? styles.photoOn : styles.photo}
                loading={i === 0 ? "eager" : "lazy"}
              />
            ))}

            {multi ? (
              <>
                <span className={styles.counter}>
                  {index + 1}/{total}
                </span>
                <button
                  type="button"
                  className={`${styles.navBtn} ${styles.navPrev}`}
                  onClick={() => go(-1)}
                  aria-label="上一張照片"
                >
                  {ARROW_LEFT}
                </button>
                <button
                  type="button"
                  className={`${styles.navBtn} ${styles.navNext}`}
                  onClick={() => go(1)}
                  aria-label="下一張照片"
                >
                  {ARROW_RIGHT}
                </button>
                <div className={styles.dots} role="group" aria-label="切換照片">
                  {photos.map((src, i) => (
                    <button
                      key={`${src}-${i}`}
                      type="button"
                      className={i === index ? styles.dotOn : styles.dot}
                      onClick={() => setIndex(i)}
                      aria-label={`看第 ${i + 1} 張照片`}
                      aria-current={i === index ? "true" : undefined}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <span className={styles.noPhoto}>照片整理中</span>
        )}

        {data.badge ? <span className={styles.badge}>{data.badge}</span> : null}
      </div>

      <div className={styles.body}>
        {data.eyebrow ? <span className={styles.eyebrow}>{data.eyebrow}</span> : null}

        <h3 className={styles.title}>
          <Link href={detailUrl} className={styles.titleLink}>
            {data.title}
          </Link>
        </h3>

        <p className={styles.price}>{data.priceText}</p>

        {data.meta ? <p className={styles.meta}>{data.meta}</p> : null}

        {data.highlights.length > 0 ? (
          <ul className={styles.highlights}>
            {data.highlights.map((h) => (
              <li key={h}>
                {BULLET}
                <span>{h}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className={styles.actions}>
          <Link href={detailUrl} className={styles.actionGhost}>
            物件資訊 <span aria-hidden="true">↗</span>
          </Link>

          {/* 沒影片就不長這顆 —— 按下去跳到空區塊比沒有按鈕更糟 */}
          {data.hasVideo ? (
            <Link href={`${detailUrl}#video`} className={styles.actionGhost}>
              影片賞析 <span aria-hidden="true">↗</span>
            </Link>
          ) : null}

          <Link href="/card/booking" className={styles.actionPrimary}>
            預約看屋
          </Link>
        </div>
      </div>
    </article>
  );
}
