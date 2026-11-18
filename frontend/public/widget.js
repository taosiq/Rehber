/* eslint-disable @typescript-eslint/no-this-alias, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions -- plain browser script (no build step), written for broad browser support */
/*!
 * Rehber chat widget. Add to any website:
 *   <script src="https://YOUR-REHBER/widget.js" data-key="pk_..." data-api="https://YOUR-API/api" defer></script>
 * Optional: data-lang="tr" (force a language), data-open="true" (start open).
 * JS API: Rehber.open(), Rehber.close(), Rehber.toggle(), Rehber.setLanguage("de").
 *
 * Security notes: the widget never inserts HTML it receives. Every message is built with DOM
 * APIs and textContent; links are limited to http(s). Styles live in a Shadow DOM, so the
 * widget and the host page can't break each other's CSS.
 */
(function () {
  "use strict";
  if (window.Rehber && window.Rehber.__rehber) return; // loaded twice

  var LANGS = ["tr", "en", "de", "ru", "fr", "ar", "fa", "ur"];
  var RTL = { ar: 1, fa: 1, ur: 1 };
  var NAMES = { tr: "Türkçe", en: "English", de: "Deutsch", ru: "Русский", fr: "Français", ar: "العربية", fa: "فارسی", ur: "اردو" };

  // prettier-ignore
  var T = {
    en: { greeting: "Hi there! 👋 How can we help you today?", placeholder: "Type your message…", send: "Send", status: "Typically replies instantly", powered: "Powered by", newChat: "New conversation", close: "Close chat", open: "Chat with us", sources: "Sources", handoff: "A team member has been notified and will get back to you soon.", error: "Something went wrong. Please try again.", language: "Language", page: "p.", dismiss: "Dismiss",
      t_search_knowledge: "Searching our documents", t_check_availability: "Checking available times", t_book_appointment: "Booking your appointment", t_get_order_status: "Looking up your order", t_handoff_to_human: "Contacting a team member",
      s_hours: "What are your opening hours?", s_book: "I'd like to book an appointment", s_order: "Where is my order?", s_human: "I'd like to talk to a person" },
    tr: { greeting: "Merhaba! 👋 Size nasıl yardımcı olabiliriz?", placeholder: "Mesajınızı yazın…", send: "Gönder", status: "Genellikle anında yanıt verir", powered: "Altyapı:", newChat: "Yeni sohbet", close: "Sohbeti kapat", open: "Bizimle sohbet edin", sources: "Kaynaklar", handoff: "Ekibimizden birine haber verildi, en kısa sürede size dönecek.", error: "Bir sorun oluştu. Lütfen tekrar deneyin.", language: "Dil", page: "s.", dismiss: "Kapat",
      t_search_knowledge: "Belgelerimizde arıyor", t_check_availability: "Uygun saatlere bakıyor", t_book_appointment: "Randevunuzu oluşturuyor", t_get_order_status: "Siparişinizi sorguluyor", t_handoff_to_human: "Ekibimize aktarıyor",
      s_hours: "Çalışma saatleriniz nedir?", s_book: "Randevu almak istiyorum", s_order: "Siparişim nerede?", s_human: "Bir yetkiliyle görüşmek istiyorum" },
    de: { greeting: "Hallo! 👋 Wie können wir Ihnen helfen?", placeholder: "Nachricht schreiben…", send: "Senden", status: "Antwortet in der Regel sofort", powered: "Bereitgestellt von", newChat: "Neuer Chat", close: "Chat schließen", open: "Chatten Sie mit uns", sources: "Quellen", handoff: "Ein Teammitglied wurde benachrichtigt und meldet sich bald bei Ihnen.", error: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.", language: "Sprache", page: "S.", dismiss: "Schließen",
      t_search_knowledge: "Durchsucht unsere Dokumente", t_check_availability: "Prüft freie Termine", t_book_appointment: "Bucht Ihren Termin", t_get_order_status: "Sucht Ihre Bestellung", t_handoff_to_human: "Verbindet mit unserem Team",
      s_hours: "Wie sind Ihre Öffnungszeiten?", s_book: "Ich möchte einen Termin buchen", s_order: "Wo ist meine Bestellung?", s_human: "Ich möchte mit einer Person sprechen" },
    ru: { greeting: "Здравствуйте! 👋 Чем мы можем помочь?", placeholder: "Напишите сообщение…", send: "Отправить", status: "Обычно отвечает сразу", powered: "Работает на", newChat: "Новый чат", close: "Закрыть чат", open: "Напишите нам", sources: "Источники", handoff: "Мы уведомили сотрудника, он скоро свяжется с вами.", error: "Что-то пошло не так. Попробуйте ещё раз.", language: "Язык", page: "с.", dismiss: "Закрыть",
      t_search_knowledge: "Ищет в наших документах", t_check_availability: "Проверяет свободное время", t_book_appointment: "Оформляет запись", t_get_order_status: "Ищет ваш заказ", t_handoff_to_human: "Передаёт сотруднику",
      s_hours: "Какой у вас график работы?", s_book: "Хочу записаться на приём", s_order: "Где мой заказ?", s_human: "Хочу поговорить с сотрудником" },
    fr: { greeting: "Bonjour ! 👋 Comment pouvons-nous vous aider ?", placeholder: "Écrivez votre message…", send: "Envoyer", status: "Répond généralement immédiatement", powered: "Propulsé par", newChat: "Nouvelle discussion", close: "Fermer la discussion", open: "Discutez avec nous", sources: "Sources", handoff: "Un membre de l'équipe a été prévenu et vous répondra rapidement.", error: "Une erreur s'est produite. Veuillez réessayer.", language: "Langue", page: "p.", dismiss: "Fermer",
      t_search_knowledge: "Recherche dans nos documents", t_check_availability: "Vérifie les créneaux disponibles", t_book_appointment: "Réserve votre rendez-vous", t_get_order_status: "Recherche votre commande", t_handoff_to_human: "Contacte notre équipe",
      s_hours: "Quels sont vos horaires ?", s_book: "Je voudrais prendre rendez-vous", s_order: "Où est ma commande ?", s_human: "Je voudrais parler à une personne" },
    ar: { greeting: "مرحباً! 👋 كيف يمكننا مساعدتك اليوم؟", placeholder: "اكتب رسالتك…", send: "إرسال", status: "يرد عادةً على الفور", powered: "مدعوم من", newChat: "محادثة جديدة", close: "إغلاق المحادثة", open: "تحدث معنا", sources: "المصادر", handoff: "تم إبلاغ أحد أعضاء فريقنا وسيتواصل معك قريباً.", error: "حدث خطأ ما. يرجى المحاولة مرة أخرى.", language: "اللغة", page: "ص.", dismiss: "إغلاق",
      t_search_knowledge: "يبحث في مستنداتنا", t_check_availability: "يتحقق من المواعيد المتاحة", t_book_appointment: "يحجز موعدك", t_get_order_status: "يبحث عن طلبك", t_handoff_to_human: "يحوّلك إلى فريقنا",
      s_hours: "ما هي ساعات العمل؟", s_book: "أريد حجز موعد", s_order: "أين طلبي؟", s_human: "أريد التحدث مع شخص" },
    fa: { greeting: "سلام! 👋 چطور می‌توانیم کمکتان کنیم؟", placeholder: "پیام خود را بنویسید…", send: "ارسال", status: "معمولاً بلافاصله پاسخ می‌دهد", powered: "قدرت‌گرفته از", newChat: "گفتگوی جدید", close: "بستن گفتگو", open: "با ما گفتگو کنید", sources: "منابع", handoff: "به یکی از همکاران ما اطلاع داده شد و به‌زودی با شما تماس می‌گیرد.", error: "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.", language: "زبان", page: "ص.", dismiss: "بستن",
      t_search_knowledge: "در اسناد ما جستجو می‌کند", t_check_availability: "زمان‌های آزاد را بررسی می‌کند", t_book_appointment: "نوبت شما را ثبت می‌کند", t_get_order_status: "سفارش شما را پیدا می‌کند", t_handoff_to_human: "شما را به همکاران ما وصل می‌کند",
      s_hours: "ساعات کاری شما چیست؟", s_book: "می‌خواهم نوبت بگیرم", s_order: "سفارش من کجاست؟", s_human: "می‌خواهم با یک شخص صحبت کنم" },
    ur: { greeting: "السلام علیکم! 👋 ہم آپ کی کیا مدد کر سکتے ہیں؟", placeholder: "اپنا پیغام لکھیں…", send: "بھیجیں", status: "عام طور پر فوری جواب ملتا ہے", powered: "تعاون:", newChat: "نئی گفتگو", close: "گفتگو بند کریں", open: "ہم سے بات کریں", sources: "ذرائع", handoff: "ہماری ٹیم کے ایک رکن کو اطلاع دے دی گئی ہے، وہ جلد آپ سے رابطہ کریں گے۔", error: "کچھ غلط ہو گیا۔ براہ کرم دوبارہ کوشش کریں۔", language: "زبان", page: "ص.", dismiss: "بند کریں",
      t_search_knowledge: "ہماری دستاویزات میں تلاش ہو رہی ہے", t_check_availability: "دستیاب اوقات دیکھے جا رہے ہیں", t_book_appointment: "آپ کی اپوائنٹمنٹ بک ہو رہی ہے", t_get_order_status: "آپ کا آرڈر تلاش ہو رہا ہے", t_handoff_to_human: "ہماری ٹیم سے رابطہ ہو رہا ہے",
      s_hours: "آپ کے اوقاتِ کار کیا ہیں؟", s_book: "میں اپوائنٹمنٹ بک کرنا چاہتا/چاہتی ہوں", s_order: "میرا آرڈر کہاں ہے؟", s_human: "میں کسی شخص سے بات کرنا چاہتا/چاہتی ہوں" },
  };

  var ICON = {
    chat: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.6A8 8 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke-width="3"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  };

  var CSS = `
:host{all:initial}
*{box-sizing:border-box}
.rb{--a:#f5b544;--on:#111;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Naskh Arabic",Tahoma,sans-serif;font-size:15px;line-height:1.5;color:#1b1b22;-webkit-font-smoothing:antialiased}
.rb.fixed .launcher,.rb.fixed .panel,.rb.fixed .teaser{position:fixed;z-index:2147483000}
.rb.inline .launcher,.rb.inline .panel,.rb.inline .teaser{position:absolute;z-index:5}
.launcher{bottom:20px;width:62px;height:62px;border:0;border-radius:50%;cursor:pointer;background:var(--a);color:var(--on);display:grid;place-items:center;box-shadow:0 10px 30px -6px color-mix(in srgb,var(--a) 70%,transparent),0 4px 12px rgba(0,0,0,.18);transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;pointer-events:auto}
.launcher:hover{transform:scale(1.07)}
.launcher:active{transform:scale(.95)}
.launcher:focus-visible,.icon-btn:focus-visible,.send:focus-visible,.chip:focus-visible{outline:3px solid color-mix(in srgb,var(--a) 55%,#000);outline-offset:2px}
.launcher::before{content:"";position:absolute;inset:0;border-radius:50%;background:var(--a);z-index:-1;animation:pulse 2.6s ease-out infinite}
.rb.is-open .launcher::before{animation:none;opacity:0}
.launcher .ic{grid-area:1/1;display:grid;transition:transform .35s cubic-bezier(.34,1.56,.64,1),opacity .2s}
.launcher .ic-x{transform:rotate(-90deg) scale(.4);opacity:0}
.rb.is-open .launcher .ic-chat{transform:rotate(90deg) scale(.4);opacity:0}
.rb.is-open .launcher .ic-x{transform:none;opacity:1}
.right .launcher,.right .teaser{right:20px}.left .launcher,.left .teaser{left:20px}
.panel{bottom:96px;width:384px;height:min(640px,calc(100% - 120px));max-height:calc(100vh - 120px);display:flex;flex-direction:column;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px -12px rgba(15,15,30,.35),0 0 0 1px rgba(15,15,30,.06);opacity:0;transform:translateY(16px) scale(.92);pointer-events:none;visibility:hidden;transition:opacity .22s ease,transform .38s cubic-bezier(.34,1.4,.64,1),visibility 0s .38s}
.rb.inline .panel{height:calc(100% - 120px);max-height:none}
.right .panel{right:20px;transform-origin:bottom right}.left .panel{left:20px;transform-origin:bottom left}
.rb.is-open .panel{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:opacity .22s ease,transform .38s cubic-bezier(.34,1.4,.64,1),visibility 0s}
header{position:relative;padding:18px 16px 18px 18px;background:linear-gradient(135deg,var(--a),color-mix(in srgb,var(--a) 62%,#3b1d6e));color:var(--on);display:flex;align-items:center;gap:12px;overflow:hidden;flex-shrink:0}
header::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.28) 50%,transparent 70%);transform:translateX(-100%);animation:shine 5s ease-in-out 1s infinite;pointer-events:none}
.avatar{position:relative;width:42px;height:42px;border-radius:14px;flex-shrink:0;display:grid;place-items:center;font-weight:700;font-size:18px;background:rgba(255,255,255,.25);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.avatar i{position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:50%;background:#22c55e;border:2.5px solid color-mix(in srgb,var(--a) 80%,#3b1d6e)}
.avatar i::after{content:"";position:absolute;inset:-2.5px;border-radius:50%;border:2px solid #22c55e;animation:ping 2s ease-out infinite}
.head-text{min-width:0;flex:1}
.title{font-weight:700;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.subtitle{font-size:12.5px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.icon-btn{position:relative;z-index:1;border:0;background:transparent;color:inherit;cursor:pointer;height:34px;min-width:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:4px;font:inherit;font-size:12px;font-weight:700;letter-spacing:.04em;transition:background .15s}
.icon-btn:hover{background:rgba(255,255,255,.22)}
.lang-btn{padding:0 8px}
.menu{position:absolute;top:66px;inset-inline-end:12px;z-index:3;background:#fff;color:#1b1b22;border-radius:14px;padding:6px;min-width:170px;box-shadow:0 18px 40px -8px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.06);transform-origin:top;opacity:0;transform:translateY(-6px) scale(.97);pointer-events:none;transition:all .18s ease}
.menu.show{opacity:1;transform:none;pointer-events:auto}
.menu button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;border:0;background:none;font:inherit;font-size:14px;padding:8px 10px;border-radius:9px;cursor:pointer;color:inherit;text-align:start}
.menu button:hover,.menu button[aria-checked=true]{background:color-mix(in srgb,var(--a) 16%,#fff)}
.menu small{font-size:11px;font-weight:700;opacity:.5}
.log{flex:1;overflow-y:auto;padding:18px 16px 8px;display:flex;flex-direction:column;gap:10px;background:radial-gradient(120% 60% at 50% 0%,color-mix(in srgb,var(--a) 7%,#fff),#fff 60%);scroll-behavior:smooth;overscroll-behavior:contain}
.log::-webkit-scrollbar{width:6px}.log::-webkit-scrollbar-thumb{background:rgba(0,0,0,.12);border-radius:9px}
.msg{max-width:86%;display:flex;flex-direction:column;gap:6px;animation:rise .35s cubic-bezier(.2,.9,.3,1.2) both}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.bot{align-self:flex-start}
.bubble{padding:10px 14px;border-radius:18px;word-wrap:break-word;overflow-wrap:anywhere;white-space:normal}
.user .bubble{background:var(--a);color:var(--on);border-end-end-radius:6px}
.bot .bubble{background:#f2f2f6;border-end-start-radius:6px}
.bubble p{margin:0}.bubble p+p,.bubble p+ul,.bubble ul+p,.bubble p+ol,.bubble ol+p{margin-top:8px}
.bubble ul,.bubble ol{margin:0;padding-inline-start:20px}
.bubble li+li{margin-top:2px}
.bubble a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.bubble code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em;background:rgba(0,0,0,.07);padding:1px 5px;border-radius:5px}
.cite{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;margin:0 2px;border-radius:6px;font-size:11px;font-weight:700;vertical-align:2px;background:color-mix(in srgb,var(--a) 30%,#fff);color:#3a2a00;cursor:help}
.sources{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:#6b6b78}
.src{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 10px 4px 4px;border-radius:999px;background:#fff;border:1px solid #e7e7ee;color:#3d3d48;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:rise .4s both}
a.src:hover{border-color:var(--a)}
.src b{display:grid;place-items:center;min-width:18px;height:18px;border-radius:50%;font-size:10.5px;background:var(--a);color:var(--on)}
.notice{align-self:center;max-width:92%;display:flex;gap:8px;align-items:flex-start;text-align:start;font-size:13px;padding:10px 14px;border-radius:14px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;animation:rise .4s both}
.notice.err{background:#fef2f2;color:#991b1b;border-color:#fecaca}
.typing{display:inline-flex;gap:5px;padding:14px 16px}
.typing i{width:7px;height:7px;border-radius:50%;background:#9a9aa8;animation:bounce 1.2s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
.caret::after{content:"";display:inline-block;width:7px;height:1em;margin-inline-start:2px;vertical-align:-2px;border-radius:2px;background:currentColor;opacity:.5;animation:blink 1s steps(2) infinite}
.tool{align-self:flex-start;display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;color:#4a3a10;background:linear-gradient(90deg,color-mix(in srgb,var(--a) 18%,#fff) 0%,color-mix(in srgb,var(--a) 38%,#fff) 50%,color-mix(in srgb,var(--a) 18%,#fff) 100%);background-size:200% 100%;animation:rise .3s both,shimmer 1.4s linear infinite}
.tool svg{animation:spin 1.6s linear infinite}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.chip{border:1px solid color-mix(in srgb,var(--a) 55%,#ddd);background:#fff;color:#2a2a33;font:inherit;font-size:13.5px;padding:7px 13px;border-radius:999px;cursor:pointer;animation:rise .4s both;transition:background .15s,transform .15s}
.chip:hover{background:color-mix(in srgb,var(--a) 15%,#fff);transform:translateY(-1px)}
form{display:flex;align-items:flex-end;gap:8px;margin:8px 12px 0;padding:6px 6px 6px 14px;border:1.5px solid #e4e4ec;border-radius:18px;background:#fff;transition:border-color .2s,box-shadow .2s;flex-shrink:0}
[dir=rtl] form{padding:6px 14px 6px 6px}
form:focus-within{border-color:var(--a);box-shadow:0 0 0 4px color-mix(in srgb,var(--a) 18%,transparent)}
textarea{flex:1;border:0;outline:0;resize:none;font:inherit;font-size:15px;color:inherit;background:transparent;max-height:120px;padding:7px 0;line-height:1.45}
textarea::placeholder{color:#9a9aa8}
.send{width:40px;height:40px;flex-shrink:0;border:0;border-radius:13px;background:var(--a);color:var(--on);cursor:pointer;display:grid;place-items:center;transition:transform .2s,opacity .2s}
.send:disabled{opacity:.35;cursor:default}
.send:not(:disabled):hover{transform:scale(1.06)}
[dir=rtl] .send svg{transform:scaleX(-1)}
.foot{text-align:center;font-size:11.5px;color:#9a9aa8;padding:8px 0 10px;flex-shrink:0}
.foot b{color:#6b6b78;font-weight:700}
.teaser{bottom:96px;max-width:270px;background:#fff;color:#1b1b22;padding:13px 34px 13px 15px;border-radius:18px;font-size:14.5px;box-shadow:0 14px 40px -10px rgba(15,15,30,.35),0 0 0 1px rgba(15,15,30,.06);cursor:pointer;opacity:0;transform:translateY(10px) scale(.9);pointer-events:none;transition:all .4s cubic-bezier(.34,1.56,.64,1)}
[dir=rtl].teaser{padding:13px 15px 13px 34px}
.right .teaser{transform-origin:bottom right}.left .teaser{transform-origin:bottom left}
.teaser.show{opacity:1;transform:none;pointer-events:auto}
.teaser .tx{position:absolute;top:6px;inset-inline-end:6px;width:24px;height:24px;border:0;border-radius:8px;background:none;color:#9a9aa8;cursor:pointer;display:grid;place-items:center}
.teaser .tx:hover{background:#f2f2f6}
@keyframes pulse{0%{transform:scale(1);opacity:.55}70%,100%{transform:scale(1.55);opacity:0}}
@keyframes ping{0%{transform:scale(1);opacity:.8}80%,100%{transform:scale(2);opacity:0}}
@keyframes shine{0%{transform:translateX(-100%)}30%,100%{transform:translateX(100%)}}
@keyframes rise{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
@keyframes blink{50%{opacity:0}}
@keyframes shimmer{to{background-position:-200% 0}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:480px){
  .rb.fixed .panel{inset:0;width:auto;height:100%;max-height:none;border-radius:0}
  .rb.fixed.is-open .launcher{opacity:0;pointer-events:none}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition-duration:.01ms!important}}
`;

  // ------------------------------------------------------------ helpers

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(name, cls) {
    var s = el("span", cls);
    s.innerHTML = ICON[name]; // constant markup defined above, never user data
    return s;
  }
  function onColor(hex) {
    var n = parseInt(hex.slice(1), 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return L > 0.42 ? "#16161d" : "#ffffff";
  }
  function safeColor(c) {
    return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#f5b544";
  }
  function pickLang(forced, fallback) {
    if (forced && LANGS.indexOf(forced) >= 0) return forced;
    var prefs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < prefs.length; i++) {
      var code = String(prefs[i]).slice(0, 2).toLowerCase();
      if (LANGS.indexOf(code) >= 0) return code;
    }
    return LANGS.indexOf(fallback) >= 0 ? fallback : "en";
  }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  /** Read a Server-Sent Events body and call h[event](data). */
  async function readSSE(res, h) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        var block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        var ev = "message", data = "";
        block.split("\n").forEach(function (line) {
          if (line.indexOf("event: ") === 0) ev = line.slice(7);
          else if (line.indexOf("data: ") === 0) data += line.slice(6);
        });
        if (data && h[ev]) h[ev](JSON.parse(data));
      }
    }
  }

  function httpError(res, body) {
    var e = new Error((body && typeof body.detail === "string" && body.detail) || "HTTP " + res.status);
    e.status = res.status;
    return e;
  }

  /** Talks to /api/public with a publishable key. */
  function httpBackend(api, key) {
    var headers = { "Content-Type": "application/json", "X-Rehber-Key": key };
    return {
      config: async function () {
        var res = await fetch(api + "/public/widget-config", { headers: { "X-Rehber-Key": key } });
        if (!res.ok) throw httpError(res, await res.json().catch(function () { return null; }));
        return res.json();
      },
      history: async function (body) {
        var res = await fetch(api + "/public/history", { method: "POST", headers: headers, body: JSON.stringify(body) });
        if (!res.ok) throw httpError(res, await res.json().catch(function () { return null; }));
        return res.json();
      },
      chat: async function (body, h, signal) {
        var res = await fetch(api + "/public/chat", { method: "POST", headers: headers, body: JSON.stringify(body), signal: signal });
        if (!res.ok || !res.body) throw httpError(res, await res.json().catch(function () { return null; }));
        await readSSE(res, h);
      },
    };
  }

  // ------------------------------------------------------------ safe message rendering

  var INLINE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[(\d+(?:\s*,\s*\d+)*)\]|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

  function renderInline(parent, text, cites) {
    var last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) parent.appendChild(link(m[2], m[1]));
      else if (m[3]) parent.appendChild(el("strong", null, m[3]));
      else if (m[4]) parent.appendChild(el("code", null, m[4]));
      else if (m[5]) m[5].split(",").forEach(function (n) {
        n = n.trim();
        var c = el("span", "cite", n);
        var src = cites[n];
        if (src) c.title = src.title + (src.page ? " · " + src.page : "");
        parent.appendChild(c);
      });
      else if (m[6]) parent.appendChild(link(m[6], m[6]));
      last = INLINE.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function link(href, text) {
    var a = el("a", null, text);
    if (/^https?:\/\//i.test(href)) {
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
    }
    return a;
  }
  /** Small markdown subset: paragraphs, bullet/numbered lists, headings as bold, inline styles. */
  function renderRich(parent, text, cites) {
    parent.textContent = "";
    var list = null, para = null;
    text.replace(/\r/g, "").split("\n").forEach(function (raw) {
      var line = raw.trim();
      var bullet = /^[-*•]\s+(.*)$/.exec(line), num = /^\d+[.)]\s+(.*)$/.exec(line);
      if (!line) { list = null; para = null; return; }
      if (bullet || num) {
        var kind = bullet ? "UL" : "OL";
        if (!list || list.tagName !== kind) { list = el(kind.toLowerCase()); parent.appendChild(list); }
        var li = el("li");
        renderInline(li, (bullet || num)[1], cites);
        list.appendChild(li);
        para = null;
        return;
      }
      list = null;
      var heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) {
        var p = el("p"), s = el("strong");
        renderInline(s, heading[1], cites);
        p.appendChild(s);
        parent.appendChild(p);
        para = null;
        return;
      }
      if (!para) { para = el("p"); parent.appendChild(para); }
      else para.appendChild(el("br"));
      renderInline(para, line, cites);
    });
  }

  // ------------------------------------------------------------ widget instance

  function Widget(opts) {
    var self = this;
    this.backend = opts.backend;
    this.inline = !!opts.inline;
    this.storageKey = opts.storageKey || null;
    this.forcedLang = opts.lang || null;
    this.cfg = null;
    this.lang = "en";
    this.convId = null;
    this.token = null;
    this.status = "open";
    this.sending = false;
    this.restored = false;
    this.items = []; // rendered messages: {role, text, cited, node, bubble}

    this.host = el("div");
    this.host.setAttribute("data-rehber-widget", "");
    if (this.inline) this.host.style.cssText = "position:absolute;inset:0;pointer-events:none";
    var root = this.host.attachShadow({ mode: "open" });
    var style = el("style");
    style.textContent = CSS;
    root.appendChild(style);

    var rb = (this.rb = el("div", "rb right " + (this.inline ? "inline" : "fixed")));
    root.appendChild(rb);

    // panel
    var panel = (this.panel = el("div", "panel"));
    panel.setAttribute("role", "dialog");
    var header = el("header");
    this.avatar = el("div", "avatar");
    this.avatarLetter = el("span");
    this.avatar.appendChild(this.avatarLetter);
    this.avatar.appendChild(el("i"));
    var ht = el("div", "head-text");
    this.titleEl = el("div", "title");
    this.subEl = el("div", "subtitle");
    ht.appendChild(this.titleEl);
    ht.appendChild(this.subEl);
    this.langBtn = el("button", "icon-btn lang-btn");
    this.langBtn.type = "button";
    this.langBtn.setAttribute("aria-haspopup", "menu");
    this.langBtn.appendChild(svg("globe"));
    this.langCode = el("span");
    this.langBtn.appendChild(this.langCode);
    this.newBtn = el("button", "icon-btn");
    this.newBtn.type = "button";
    this.newBtn.appendChild(svg("refresh"));
    this.closeBtn = el("button", "icon-btn");
    this.closeBtn.type = "button";
    this.closeBtn.appendChild(svg("x"));
    [this.avatar, ht, this.langBtn, this.newBtn, this.closeBtn].forEach(function (n) { header.appendChild(n); });

    this.menu = el("div", "menu");
    this.menu.setAttribute("role", "menu");
    LANGS.forEach(function (code) {
      var b = el("button");
      b.type = "button";
      b.setAttribute("role", "menuitemradio");
      b.dataset.lang = code;
      b.appendChild(el("span", null, NAMES[code]));
      b.appendChild(el("small", null, code.toUpperCase()));
      b.lang = code;
      b.dir = RTL[code] ? "rtl" : "ltr";
      b.addEventListener("click", function () { self.setLanguage(code); self.toggleMenu(false); self.input.focus(); });
      self.menu.appendChild(b);
    });

    this.log = el("div", "log");
    this.log.setAttribute("aria-live", "polite");
    this.form = el("form");
    this.input = el("textarea");
    this.input.rows = 1;
    this.input.maxLength = 2000;
    this.sendBtn = el("button", "send");
    this.sendBtn.type = "submit";
    this.sendBtn.disabled = true;
    this.sendBtn.appendChild(svg("send"));
    this.form.appendChild(this.input);
    this.form.appendChild(this.sendBtn);
    this.foot = el("div", "foot");
    this.footLabel = el("span");
    this.foot.appendChild(this.footLabel);
    this.foot.appendChild(document.createTextNode(" "));
    this.foot.appendChild(el("b", null, "Rehber"));
    [header, this.menu, this.log, this.form, this.foot].forEach(function (n) { panel.appendChild(n); });

    // teaser + launcher
    this.teaser = el("div", "teaser");
    this.teaserText = el("span");
    this.teaserX = el("button", "tx");
    this.teaserX.type = "button";
    this.teaserX.appendChild(svg("x"));
    this.teaser.appendChild(this.teaserText);
    this.teaser.appendChild(this.teaserX);
    this.launcher = el("button", "launcher");
    this.launcher.type = "button";
    this.launcher.setAttribute("aria-expanded", "false");
    this.launcher.appendChild(svg("chat", "ic ic-chat"));
    this.launcher.appendChild(svg("x", "ic ic-x"));
    rb.appendChild(panel);
    rb.appendChild(this.teaser);
    rb.appendChild(this.launcher);

    // events
    this.launcher.addEventListener("click", function () { self.toggle(); });
    this.closeBtn.addEventListener("click", function () { self.close(); });
    this.newBtn.addEventListener("click", function () { self.reset(); });
    this.langBtn.addEventListener("click", function (e) { e.stopPropagation(); self.toggleMenu(); });
    panel.addEventListener("click", function (e) { if (!self.menu.contains(e.target)) self.toggleMenu(false); });
    this.teaser.addEventListener("click", function () { self.open(); });
    this.teaserX.addEventListener("click", function (e) { e.stopPropagation(); self.hideTeaser(true); });
    this.input.addEventListener("input", function () { self.autosize(); self.sendBtn.disabled = self.sending || !self.input.value.trim(); });
    this.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); self.submit(); }
    });
    this.form.addEventListener("submit", function (e) { e.preventDefault(); self.submit(); });
    rb.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (self.menu.classList.contains("show")) self.toggleMenu(false); else self.close(); }
    });

    var saved = this.storageKey ? store.get(this.storageKey) : null;
    if (saved && saved.ts && Date.now() - saved.ts < 30 * 864e5) {
      this.convId = saved.id || null;
      this.token = saved.token || null;
      this.savedLang = saved.lang;
    }
  }

  Widget.prototype.t = function (k) {
    return (T[this.lang] || T.en)[k] || T.en[k];
  };

  Widget.prototype.applyConfig = function (cfg) {
    this.cfg = cfg;
    var w = cfg.widget || {};
    var color = safeColor(w.color);
    this.rb.style.setProperty("--a", color);
    this.rb.style.setProperty("--on", onColor(color));
    this.rb.classList.toggle("left", w.position === "left");
    this.rb.classList.toggle("right", w.position !== "left");
    var title = w.title || cfg.business_name || "Chat";
    this.titleEl.textContent = title;
    this.avatarLetter.textContent = title.trim().charAt(0).toUpperCase();
    if (!this.langChosen) this.setLanguage(pickLang(this.forcedLang || this.savedLang, cfg.default_language), false);
    else this.relabel();
  };

  Widget.prototype.greeting = function () {
    var g = this.cfg && this.cfg.widget && this.cfg.widget.greetings;
    return (g && g[this.lang]) || this.t("greeting");
  };

  Widget.prototype.setLanguage = function (code, byUser) {
    if (LANGS.indexOf(code) < 0) return;
    this.lang = code;
    if (byUser !== false) this.langChosen = true;
    this.relabel();
    this.persist();
  };

  /** Update every UI string and the text direction for the current language. */
  Widget.prototype.relabel = function () {
    var dir = RTL[this.lang] ? "rtl" : "ltr";
    this.panel.dir = dir;
    this.panel.lang = this.lang;
    this.teaser.dir = dir;
    this.panel.setAttribute("aria-label", this.titleEl.textContent);
    this.subEl.textContent = this.t("status");
    this.langCode.textContent = this.lang.toUpperCase();
    this.langBtn.setAttribute("aria-label", this.t("language"));
    this.langBtn.title = this.t("language");
    this.newBtn.setAttribute("aria-label", this.t("newChat"));
    this.newBtn.title = this.t("newChat");
    this.closeBtn.setAttribute("aria-label", this.t("close"));
    this.launcher.setAttribute("aria-label", this.isOpen ? this.t("close") : this.t("open"));
    this.input.placeholder = this.t("placeholder");
    this.input.dir = "auto";
    this.sendBtn.setAttribute("aria-label", this.t("send"));
    this.footLabel.textContent = this.t("powered");
    this.teaserText.textContent = this.greeting();
    this.teaserX.setAttribute("aria-label", this.t("dismiss"));
    var self = this;
    Array.prototype.forEach.call(this.menu.children, function (b) { b.setAttribute("aria-checked", String(b.dataset.lang === self.lang)); });
    if (!this.items.length && !this.sending) this.showWelcome();
  };

  Widget.prototype.showWelcome = function () {
    this.log.textContent = "";
    this.items = [];
    this.addBubble("bot", this.greeting(), [], true);
    var tools = (this.cfg && this.cfg.tools) || {};
    if (this.cfg && this.cfg.widget && this.cfg.widget.suggestions === false) return;
    var keys = ["s_hours"];
    if (tools.booking) keys.push("s_book");
    if (tools.orders) keys.push("s_order");
    if (tools.handoff) keys.push("s_human");
    var chips = el("div", "chips");
    var self = this;
    keys.forEach(function (k, i) {
      var c = el("button", "chip", self.t(k));
      c.type = "button";
      c.style.animationDelay = 0.15 + i * 0.07 + "s";
      c.addEventListener("click", function () { self.send(self.t(k)); });
      chips.appendChild(c);
    });
    this.chips = chips;
    this.log.appendChild(chips);
  };

  /** Adds a message bubble. `welcome` bubbles are UI only and are not part of the conversation. */
  Widget.prototype.addBubble = function (role, text, cited, welcome) {
    var node = el("div", "msg " + role);
    var bubble = el("div", "bubble");
    bubble.dir = "auto";
    node.appendChild(bubble);
    var item = { role: role, text: text || "", cited: cited || [], node: node, bubble: bubble, welcome: !!welcome };
    this.renderItem(item);
    this.log.appendChild(node);
    if (!welcome) this.items.push(item);
    this.scroll(true);
    return item;
  };

  Widget.prototype.renderItem = function (item) {
    if (item.role === "user") item.bubble.textContent = item.text;
    else {
      var map = {};
      (item.cited || []).forEach(function (s) { map[String(s.n)] = s; });
      renderRich(item.bubble, item.text, map);
    }
    if (item.sourcesEl) { item.sourcesEl.remove(); item.sourcesEl = null; }
    if (item.role === "bot" && item.cited && item.cited.length) {
      var box = el("div", "sources");
      box.setAttribute("aria-label", this.t("sources"));
      var self = this;
      item.cited.forEach(function (s, i) {
        var chip = s.url ? link(s.url, "") : el("span");
        chip.className = "src";
        chip.style.animationDelay = i * 0.06 + "s";
        chip.appendChild(el("b", null, String(s.n)));
        chip.appendChild(document.createTextNode((s.title || "") + (s.page ? " · " + self.t("page") + " " + s.page : "")));
        box.appendChild(chip);
      });
      item.node.appendChild(box);
      item.sourcesEl = box;
    }
  };

  Widget.prototype.notice = function (text, isError) {
    var n = el("div", "notice" + (isError ? " err" : ""));
    n.dir = "auto";
    if (!isError) n.appendChild(svg("person"));
    n.appendChild(el("span", null, text));
    this.log.appendChild(n);
    this.scroll(true);
  };

  Widget.prototype.scroll = function (force) {
    var log = this.log;
    var near = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (force || near) requestAnimationFrame(function () { log.scrollTop = log.scrollHeight; });
  };

  Widget.prototype.autosize = function () {
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 120) + "px";
  };

  Widget.prototype.persist = function () {
    if (!this.storageKey) return;
    store.set(this.storageKey, { id: this.convId, token: this.token, lang: this.langChosen ? this.lang : null, ts: Date.now() });
  };

  Widget.prototype.restore = async function () {
    if (this.restored) return;
    this.restored = true;
    if (!this.convId || !this.backend.history) return;
    try {
      var h = await this.backend.history({ conversation_id: this.convId, conversation_token: this.token });
      if (!h.messages || !h.messages.length || this.items.length) return;
      this.log.textContent = "";
      this.items = [];
      var self = this;
      h.messages.forEach(function (m) {
        var item = self.addBubble(m.role === "user" ? "user" : "bot", m.content, m.cited, false);
        item.node.style.animation = "none";
      });
      this.status = h.status;
      if (h.status === "handoff") this.notice(this.t("handoff"));
      this.scroll(true);
    } catch (e) {
      // expired or unknown conversation: start fresh
      this.convId = this.token = null;
      this.persist();
    }
  };

  Widget.prototype.submit = function () {
    var text = this.input.value.trim();
    if (!text || this.sending) return;
    this.input.value = "";
    this.autosize();
    this.send(text);
  };

  Widget.prototype.send = async function (text) {
    if (this.sending) return;
    var self = this;
    this.sending = true;
    this.sendBtn.disabled = true;
    if (this.chips) { this.chips.remove(); this.chips = null; }
    this.addBubble("user", text);

    var typing = el("div", "msg bot");
    var tb = el("div", "bubble typing");
    tb.appendChild(el("i")); tb.appendChild(el("i")); tb.appendChild(el("i"));
    typing.appendChild(tb);
    this.log.appendChild(typing);
    this.scroll(true);

    var bot = null, toolPill = null, frame = 0;
    var running = {};
    function ensureBot() {
      if (!bot) {
        typing.remove();
        bot = self.addBubble("bot", "");
        bot.bubble.classList.add("caret");
      }
      return bot;
    }
    function paint() {
      frame = 0;
      if (bot) { self.renderItem(bot); self.scroll(false); }
    }
    function showTool() {
      var names = Object.keys(running).map(function (k) { return running[k]; });
      if (toolPill) { toolPill.remove(); toolPill = null; }
      if (!names.length) return;
      toolPill = el("div", "tool");
      toolPill.appendChild(svg("spark"));
      toolPill.appendChild(el("span", null, self.t("t_" + names[names.length - 1]) || self.t("t_search_knowledge")));
      self.log.insertBefore(toolPill, typing.parentNode ? typing : null);
      self.scroll(false);
    }

    var body = { message: text, conversation_id: this.convId, conversation_token: this.token, language: this.lang };
    this.abort = typeof AbortController !== "undefined" ? new AbortController() : null;
    try {
      await this.backend.chat(body, {
        meta: function (d) {
          self.convId = d.conversation_id;
          if (d.conversation_token) self.token = d.conversation_token;
          // Follow the customer's language: an Arabic question switches the UI to Arabic (RTL).
          if (d.language && d.language !== self.lang) { self.lang = d.language; self.relabel(); }
          self.persist();
        },
        token: function (d) {
          var b = ensureBot();
          if (!b.text && !d.text.trim()) return;
          b.text += d.text;
          if (!frame) frame = requestAnimationFrame(paint);
        },
        tool: function (d) {
          if (d.status === "running") running[d.id] = d.name;
          else delete running[d.id];
          showTool();
        },
        done: function (d) {
          running = {};
          showTool();
          var b = ensureBot();
          b.bubble.classList.remove("caret");
          b.cited = d.cited || [];
          if (frame) { cancelAnimationFrame(frame); frame = 0; }
          if (!b.text.trim()) { b.node.remove(); self.items.splice(self.items.indexOf(b), 1); }
          else self.renderItem(b);
          if (d.conversation_status === "handoff" && self.status !== "handoff") self.notice(self.t("handoff"));
          self.status = d.conversation_status || self.status;
          self.scroll(true);
        },
        error: function (d) {
          running = {};
          showTool();
          typing.remove();
          if (bot) bot.bubble.classList.remove("caret");
          self.notice(d.message || self.t("error"), true);
        },
      }, this.abort && this.abort.signal);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      running = {};
      showTool();
      typing.remove();
      if (bot) bot.bubble.classList.remove("caret");
      if (e && e.status === 403 && /token/i.test(e.message)) { this.convId = this.token = null; this.persist(); }
      // Server messages for 4xx (e.g. "too quickly") are useful; network/5xx get a friendly text.
      this.notice(e && e.status && e.status < 500 ? e.message : this.t("error"), true);
      if (e && e.status === 403) console.warn("[Rehber] " + e.message);
    } finally {
      typing.remove();
      if (bot) bot.bubble.classList.remove("caret");
      this.sending = false;
      this.abort = null;
      this.sendBtn.disabled = !this.input.value.trim();
    }
  };

  Widget.prototype.reset = function () {
    if (this.abort) this.abort.abort();
    this.sending = false;
    this.convId = this.token = null;
    this.status = "open";
    this.items = [];
    this.persist();
    this.showWelcome();
    this.input.focus();
  };

  Widget.prototype.toggleMenu = function (show) {
    var on = show == null ? !this.menu.classList.contains("show") : show;
    this.menu.classList.toggle("show", on);
    this.langBtn.setAttribute("aria-expanded", String(on));
  };

  Widget.prototype.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this.hideTeaser(true);
    this.rb.classList.add("is-open");
    this.launcher.setAttribute("aria-expanded", "true");
    this.launcher.setAttribute("aria-label", this.t("close"));
    this.restore();
    var input = this.input;
    if (!this.inline) setTimeout(function () { input.focus({ preventScroll: true }); }, 250);
  };
  Widget.prototype.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.toggleMenu(false);
    this.rb.classList.remove("is-open");
    this.launcher.setAttribute("aria-expanded", "false");
    this.launcher.setAttribute("aria-label", this.t("open"));
    if (!this.inline) this.launcher.focus({ preventScroll: true });
  };
  Widget.prototype.toggle = function () { this.isOpen ? this.close() : this.open(); };

  Widget.prototype.showTeaser = function () {
    if (this.isOpen || this.items.length) return;
    try { if (sessionStorage.getItem("rehber:teaser")) return; } catch (e) {}
    this.teaser.classList.add("show");
  };
  Widget.prototype.hideTeaser = function (remember) {
    this.teaser.classList.remove("show");
    if (remember && !this.inline) { try { sessionStorage.setItem("rehber:teaser", "1"); } catch (e) {} }
  };

  Widget.prototype.destroy = function () {
    if (this.abort) this.abort.abort();
    this.host.remove();
  };

  // ------------------------------------------------------------ public API

  var instance = null;
  var queued = [];
  function call(fn) { return function (arg) { if (instance) instance[fn](arg); else queued.push([fn, arg]); }; }

  window.Rehber = {
    __rehber: 1,
    open: call("open"),
    close: call("close"),
    toggle: call("toggle"),
    setLanguage: call("setLanguage"),
    /**
     * Mount a widget inside an element (used by the Rehber dashboard preview).
     * opts: { config, backend: { chat(body, handlers, signal) }, open, lang }
     * Returns { update(config), setLanguage(code), open(), close(), destroy() }.
     */
    mount: function (container, opts) {
      var w = new Widget({ backend: opts.backend, inline: true, lang: opts.lang });
      container.appendChild(w.host);
      w.applyConfig(opts.config);
      if (opts.open !== false) w.open();
      return {
        update: function (cfg) { w.applyConfig(cfg); if (!w.items.length && !w.sending) w.showWelcome(); },
        setLanguage: function (code) { w.setLanguage(code); },
        open: function () { w.open(); },
        close: function () { w.close(); },
        destroy: function () { w.destroy(); },
      };
    },
  };

  // ------------------------------------------------------------ auto-start from the <script> tag

  var script = document.currentScript || document.querySelector("script[data-key][src*='widget']");
  var key = script && script.getAttribute("data-key");
  if (!key) return;
  if (key.indexOf("pk_") !== 0) {
    console.error("[Rehber] data-key must be a publishable key (pk_...). Never put a secret key (sk_...) on a website.");
    return;
  }
  var api = (script.getAttribute("data-api") || new URL(script.src, location.href).origin + "/api").replace(/\/+$/, "");
  var backend = httpBackend(api, key);
  var cacheKey = "rehber:cfg:" + key.slice(0, 11);

  async function start() {
    var cfg = null;
    try {
      var cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
      if (cached && Date.now() - cached.ts < 5 * 60e3) cfg = cached.cfg;
    } catch (e) {}
    if (!cfg) {
      try {
        cfg = await backend.config();
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), cfg: cfg })); } catch (e) {}
      } catch (e) {
        console.error("[Rehber] Widget could not start: " + e.message + (e.status === 403 ? " Add " + location.origin + " to this key's allowed websites in the Rehber dashboard." : ""));
        return;
      }
    }
    var w = (instance = new Widget({ backend: backend, storageKey: "rehber:" + key.slice(0, 11), lang: script.getAttribute("data-lang") }));
    document.body.appendChild(w.host);
    w.applyConfig(cfg);
    queued.forEach(function (q) { w[q[0]](q[1]); });
    queued = [];
    if (script.getAttribute("data-open") === "true") w.open();
    else setTimeout(function () { w.showTeaser(); }, 3500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
