// ==============================================================
// comments-widget.js
// コミュニティコメント・動画コメント・動画リアクションで共通利用する
// フロントエンド側の描画/送信ロジック。
// バックエンドはJSON(id, parent_id, username, content, created_at, reactions)
// を返すだけで、ツリー組み立てと絵文字の見た目はここで処理する。
// ==============================================================

// リアクションの絵文字はここで一元管理(バックエンドはtype名だけ知っていればいい)
const REACTIONS = [
  { type: "good", emoji: "👍" },
  { type: "bad", emoji: "👎" },
  { type: "thinking", emoji: "🤔" },
  { type: "confused", emoji: "😕" },
  { type: "surprised", emoji: "😲" },
];

function cwEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function cwBuildCommentTree(flatComments) {
  const byId = new Map();
  flatComments.forEach((c) => byId.set(c.id, Object.assign({}, c, { replies: [] })));
  const roots = [];
  byId.forEach((c) => {
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id).replies.push(c);
    } else {
      roots.push(c);
    }
  });
  return roots;
}

// 「自分が既にこのリアクションを押したか」はブラウザのlocalStorageで覚えておく
// (ログイン無し・匿名なので、サーバー側では誰が押したか判定できないため)
function cwReactionKey(scope, targetId, type) {
  return `reacted:${scope}:${targetId}:${type}`;
}

function cwHasReacted(scope, targetId, type) {
  return localStorage.getItem(cwReactionKey(scope, targetId, type)) === "1";
}

function cwSetReacted(scope, targetId, type, reacted) {
  const key = cwReactionKey(scope, targetId, type);
  if (reacted) {
    localStorage.setItem(key, "1");
  } else {
    localStorage.removeItem(key);
  }
}

function cwReactionButtonsHtml(scope, targetId, reactions) {
  return REACTIONS.map((r) => {
    const active = cwHasReacted(scope, targetId, r.type);
    return `
    <button class="cw-reaction-btn${active ? " cw-active" : ""}" data-scope="${scope}" data-id="${targetId}" data-type="${r.type}">
      ${r.emoji} <span class="cw-reaction-count">${(reactions && reactions[r.type]) || 0}</span>
    </button>`;
  }).join("");
}

function cwCommentNodeHtml(comment, depth) {
  const indent = Math.min(depth, 6) * 16;
  const children = comment.replies.map((c) => cwCommentNodeHtml(c, depth + 1)).join("");
  return `
    <div class="cw-comment" style="margin-left:${indent}px;" data-comment-id="${comment.id}">
      <div class="cw-comment-user">${cwEscapeHtml(comment.username || "名無し")}</div>
      <div class="cw-comment-body">${cwEscapeHtml(comment.content)}</div>
      <div class="cw-comment-meta">${cwEscapeHtml(comment.created_at)}</div>
      <div class="cw-reaction-row">${cwReactionButtonsHtml("comment", comment.id, comment.reactions)}</div>
      <button class="cw-reply-toggle" data-id="${comment.id}">返信</button>
      <div class="cw-reply-form" id="cw-reply-form-${comment.id}" style="display:none;">
        <input type="text" class="cw-reply-name" placeholder="名前(任意、空なら「名無し」)">
        <textarea class="cw-reply-content" rows="2" placeholder="返信を入力"></textarea>
        <button class="cw-reply-submit" data-id="${comment.id}">送信</button>
        <div class="cw-reply-error" style="color:red;display:none;font-size:0.8rem;"></div>
      </div>
      <div class="cw-replies">${children}</div>
    </div>`;
}

/**
 * コメント一覧を取得して描画する。
 * options:
 *   fetchUrl:          GETするURL
 *   postUrl:           POSTするURL(返信もここに parent_id 付きで送る)
 *   reactUrlBuilder:   (commentId) => リアクションPOST先URL
 */
async function cwLoadComments(containerEl, options) {
  containerEl.innerHTML = "読み込み中...";
  try {
    const res = await fetch(options.fetchUrl);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      containerEl.innerHTML = `<p>読み込みに失敗しました (status: ${res.status})</p><pre style="white-space:pre-wrap;font-size:0.75rem;color:#900;">${cwEscapeHtml(text.slice(0, 500))}</pre>`;
      return;
    }
    const comments = await res.json();
    if (comments.length === 0) {
      containerEl.innerHTML = "<p>まだコメントがありません。</p>";
      return;
    }
    const tree = cwBuildCommentTree(comments);
    // 新しい投稿が上に来るよう反転(トップレベルのみ)
    containerEl.innerHTML = tree
      .slice()
      .reverse()
      .map((c) => cwCommentNodeHtml(c, 0))
      .join("");
    cwAttachEvents(containerEl, options);
  } catch (e) {
    containerEl.innerHTML = "<p>通信エラー: " + cwEscapeHtml(e.message) + "</p>";
  }
}

function cwAttachEvents(containerEl, options) {
  containerEl.querySelectorAll(".cw-reply-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const area = document.getElementById("cw-reply-form-" + btn.dataset.id);
      area.style.display = area.style.display === "none" ? "block" : "none";
    });
  });

  containerEl.querySelectorAll(".cw-reply-submit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const parentId = Number(btn.dataset.id);
      const area = document.getElementById("cw-reply-form-" + parentId);
      const nameInput = area.querySelector(".cw-reply-name");
      const contentInput = area.querySelector(".cw-reply-content");
      const errorEl = area.querySelector(".cw-reply-error");
      const content = contentInput.value.trim();
      if (!content) return;

      const username = nameInput.value.trim();
      if (username) localStorage.setItem("displayName", username);

      try {
        const res = await fetch(options.postUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, username, parent_id: parentId }),
        });
        if (res.ok) {
          cwLoadComments(containerEl, options);
        } else {
          const data = await res.json().catch(() => ({}));
          errorEl.textContent = data.error || "返信の投稿に失敗しました";
          errorEl.style.display = "block";
        }
      } catch (e) {
        errorEl.textContent = "通信エラー: " + e.message;
        errorEl.style.display = "block";
      }
    });
  });

  containerEl.querySelectorAll(".cw-reaction-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const scope = btn.dataset.scope;
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const alreadyReacted = cwHasReacted(scope, id, type);
      const delta = alreadyReacted ? -1 : 1;

      btn.disabled = true;
      try {
        const res = await fetch(options.reactUrlBuilder(id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, delta }),
        });
        if (res.ok) {
          const data = await res.json();
          btn.querySelector(".cw-reaction-count").textContent = data.reactions[type];
          cwSetReacted(scope, id, type, !alreadyReacted);
          btn.classList.toggle("cw-active", !alreadyReacted);
        }
      } catch (e) {
        // 連打で失敗しても静かに無視
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/**
 * トップレベル投稿フォーム(名前欄・本文欄・送信ボタン・エラー表示)をまとめて配線する。
 */
function cwSetupTopLevelForm({ nameInputId, contentInputId, submitBtnId, errorId, postUrl, containerEl, fetchOptions }) {
  const nameInput = document.getElementById(nameInputId);
  const contentInput = document.getElementById(contentInputId);
  const submitBtn = document.getElementById(submitBtnId);
  const errorEl = errorId ? document.getElementById(errorId) : null;

  nameInput.value = localStorage.getItem("displayName") || "";

  submitBtn.addEventListener("click", async () => {
    if (errorEl) errorEl.style.display = "none";
    const content = contentInput.value.trim();
    if (!content) return;
    const username = nameInput.value.trim();
    if (username) localStorage.setItem("displayName", username);

    try {
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, username }),
      });
      if (res.ok) {
        contentInput.value = "";
        cwLoadComments(containerEl, fetchOptions);
      } else {
        const data = await res.json().catch(() => ({}));
        if (errorEl) {
          errorEl.textContent = data.error || "コメントの投稿に失敗しました";
          errorEl.style.display = "block";
        }
      }
    } catch (e) {
      if (errorEl) {
        errorEl.textContent = "通信エラー: " + e.message;
        errorEl.style.display = "block";
      }
    }
  });
}

/**
 * 動画そのものへの5種類のリアクションボタンを描画する。
 * watch.html側で「動画の下に置きたい要素」に対して呼び出す想定:
 *   cwRenderVideoReactions(document.getElementById('video-reactions'), videoId, video.reactions, BACKEND_URL + '/videos/' + videoId + '/react');
 */
function cwRenderVideoReactions(containerEl, videoId, initialReactions, reactUrl) {
  containerEl.innerHTML = cwReactionButtonsHtml("video", videoId, initialReactions);

  containerEl.querySelectorAll(".cw-reaction-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.type;
      const alreadyReacted = cwHasReacted("video", videoId, type);
      const delta = alreadyReacted ? -1 : 1;

      btn.disabled = true;
      try {
        const res = await fetch(reactUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, delta }),
        });
        if (res.ok) {
          const data = await res.json();
          btn.querySelector(".cw-reaction-count").textContent = data.reactions[type];
          cwSetReacted("video", videoId, type, !alreadyReacted);
          btn.classList.toggle("cw-active", !alreadyReacted);
        }
      } catch (e) {
        // 無視
      } finally {
        btn.disabled = false;
      }
    });
  });
                              }
