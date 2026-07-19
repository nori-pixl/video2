// 全ページ共通: ヘッダーのログイン状態表示とログアウト処理
async function initHeader() {
  const el = document.getElementById('auth-status');
  if (!el) return;
  try {
    const res = await fetch('https://ave-helped-humanities-knee.trycloudflare.com/api/me', {
      credentials: 'include',
    });
    const user = await res.json();
    if (user) {
      el.innerHTML = `${escapeHtmlCommon(user.username)}さん | <a href="#" id="logout-link">ログアウト</a>`;
      document.getElementById('logout-link').addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('https://ave-helped-humanities-knee.trycloudflare.com/api/logout', {
          method: 'POST',
          credentials: 'include',
        });
        location.href = '/';
      });
    } else {
      el.innerHTML = `<a href="login.html">ログイン</a> | <a href="register.html">新規登録</a>`;
    }
  } catch (e) {
    el.textContent = '';
  }
}

function escapeHtmlCommon(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

initHeader();