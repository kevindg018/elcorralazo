(function () {
  const DEFAULT_TABLES = 12;

  function ensureData(db) {
    if (!db.waiterModule || typeof db.waiterModule !== 'object') {
      db.waiterModule = {};
    }
    if (!Array.isArray(db.waiterModule.tables) || db.waiterModule.tables.length === 0) {
      db.waiterModule.tables = Array.from({ length: DEFAULT_TABLES }, (_, idx) => ({
        id: `M${idx + 1}`,
        name: `Mesa ${idx + 1}`
      }));
    }
    if (!Array.isArray(db.waiterModule.comandas)) {
      db.waiterModule.comandas = [];
    }
  }

  function getActiveComandaByTable(db, tableId) {
    ensureData(db);
    return db.waiterModule.comandas.find((c) => c.tableId === tableId && c.status !== 'closed') || null;
  }

  function getTableVisualStatus(comanda) {
    if (!comanda || !Array.isArray(comanda.items) || comanda.items.length === 0) {
      return { label: 'Libre', classes: 'border-emerald-700 bg-emerald-950/40 text-emerald-300' };
    }
    if (comanda.status === 'sent' || comanda.status === 'loaded') {
      return { label: 'Con pedido', classes: 'border-rose-700 bg-rose-950/40 text-rose-300' };
    }
    return { label: 'Borrador', classes: 'border-amber-700 bg-amber-950/40 text-amber-300' };
  }

  function openOrCreateComanda(db, tableId, waiterUser) {
    let comanda = getActiveComandaByTable(db, tableId);
    if (!comanda) {
      comanda = {
        id: `CMD-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        tableId,
        waiterUser,
        status: 'draft',
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sentAt: null,
        loadedAt: null,
        closedAt: null
      };
      db.waiterModule.comandas.push(comanda);
    }
    return comanda;
  }

  function toCartItems(items) {
    return (items || []).map((item) => ({
      id: item.productId,
      name: item.name,
      price: Number(item.price),
      qty: Number(item.qty),
      qtyStep: 0.001,
      originalPrice: Number(item.price),
      measure: item.measure || 'Unidad',
      priceOptions: [Number(item.price), null, null],
      selectedPriceIndex: 0
    }));
  }

  function render(container, context) {
    const { db, saveDB, formatMoney, showToast, refreshPOSSearchIndex, loadOrderToPos } = context;
    ensureData(db);

    let selectedTableId = db.waiterModule.tables[0]?.id || null;
    let waiterSearch = '';

    function redraw() {
      const products = (db.products || []).filter((p) => {
        if (!waiterSearch) return true;
        const text = `${p.name || ''} ${p.code || ''} ${p.category || ''}`.toLowerCase();
        return text.includes(waiterSearch.toLowerCase());
      });

      const tableCards = db.waiterModule.tables.map((table) => {
        const comanda = getActiveComandaByTable(db, table.id);
        const status = getTableVisualStatus(comanda);
        const activeClass = selectedTableId === table.id ? 'ring-2 ring-amber-500' : '';
        const itemsCount = comanda?.items?.reduce((acc, item) => acc + (Number(item.qty) || 0), 0) || 0;
        return `
          <button onclick="WaitersModule.selectTable('${table.id}')" class="text-left p-3 rounded-xl border ${status.classes} ${activeClass} transition hover:scale-[1.01]">
            <div class="font-bold">${table.name}</div>
            <div class="text-xs opacity-80 mt-1">Estado: ${status.label}</div>
            <div class="text-xs opacity-80">Items: ${itemsCount}</div>
          </button>
        `;
      }).join('');

      const activeComanda = selectedTableId ? openOrCreateComanda(db, selectedTableId, db.currentUser?.user || 'mesero') : null;

      const comandaItems = activeComanda?.items?.length
        ? activeComanda.items.map((item, idx) => `
            <div class="bg-slate-900 border border-slate-700 rounded-lg p-2 flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-semibold text-slate-200">${item.name}</div>
                <div class="text-xs text-slate-500">${item.qty} x ${formatMoney(item.price)}</div>
              </div>
              <div class="flex items-center gap-1">
                <button onclick="WaitersModule.updateQty(${idx}, -1)" class="px-2 py-1 text-xs bg-slate-700 rounded">-</button>
                <button onclick="WaitersModule.updateQty(${idx}, 1)" class="px-2 py-1 text-xs bg-slate-700 rounded">+</button>
                <button onclick="WaitersModule.removeItem(${idx})" class="px-2 py-1 text-xs bg-red-800 rounded">x</button>
              </div>
            </div>
          `).join('')
        : '<div class="text-slate-500 text-sm">Sin productos agregados.</div>';

      const productsHtml = products.length
        ? products.map((p) => `
            <button onclick="WaitersModule.addProduct('${p.id}')" class="text-left bg-slate-800 border border-slate-700 rounded-lg p-3 hover:border-amber-500 transition">
              <div class="font-semibold text-slate-200 text-sm">${p.name}</div>
              <div class="text-xs text-slate-500">${p.category || 'Sin categoría'} · ${p.code || 'Sin código'}</div>
              <div class="text-amber-400 font-bold mt-1">${formatMoney(p.sellPrices?.[0] ?? p.sellPrice ?? 0)}</div>
            </button>
          `).join('')
        : '<div class="text-slate-500 text-sm col-span-full">No se encontraron productos.</div>';

      container.innerHTML = `
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 h-full min-h-0">
          <section class="xl:col-span-1 bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col min-h-0">
            <h3 class="font-bold text-amber-500 mb-3">Vista de salón</h3>
            <div class="grid grid-cols-2 gap-2 overflow-y-auto pr-1">${tableCards}</div>
          </section>

          <section class="xl:col-span-1 bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col min-h-0">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-bold text-amber-500">Comanda · ${selectedTableId || 'Sin mesa'}</h3>
              <span class="text-xs text-slate-500">${activeComanda?.status || 'draft'}</span>
            </div>
            <div class="flex-1 overflow-y-auto space-y-2 pr-1">${comandaItems}</div>
            <div class="pt-3 border-t border-slate-700 mt-3 space-y-2">
              <button onclick="WaitersModule.sendOrder()" class="w-full py-2 rounded-lg bg-amber-500 text-slate-900 font-bold">Enviar pedido</button>
              <button onclick="WaitersModule.sendToPOS()" class="w-full py-2 rounded-lg bg-indigo-600 text-white font-bold">Mandar a caja</button>
              <button onclick="WaitersModule.clearOrder()" class="w-full py-2 rounded-lg bg-slate-700 text-slate-200">Limpiar comanda</button>
            </div>
          </section>

          <section class="xl:col-span-1 bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col min-h-0">
            <div class="flex items-center gap-2 mb-3">
              <h3 class="font-bold text-amber-500">Menú</h3>
              <input id="waiter-search" placeholder="Buscar..." class="ml-auto bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm w-44">
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto pr-1">${productsHtml}</div>
          </section>
        </div>
      `;

      const searchInput = document.getElementById('waiter-search');
      if (searchInput) {
        searchInput.value = waiterSearch;
        searchInput.addEventListener('input', (e) => {
          waiterSearch = e.target.value || '';
          redraw();
        });
      }
    }

    window.WaitersModule = {
      ...(window.WaitersModule || {}),
      selectTable(tableId) {
        selectedTableId = tableId;
        redraw();
      },
      addProduct(productId) {
        const product = db.products.find((p) => String(p.id) === String(productId));
        if (!product || !selectedTableId) return;
        const comanda = openOrCreateComanda(db, selectedTableId, db.currentUser?.user || 'mesero');
        const existing = comanda.items.find((it) => String(it.productId) === String(productId));
        const basePrice = Number(product.sellPrices?.[0] ?? product.sellPrice ?? 0);
        if (existing) {
          existing.qty = Number((Number(existing.qty) + 1).toFixed(3));
        } else {
          comanda.items.push({
            productId: product.id,
            name: product.name,
            qty: 1,
            price: basePrice,
            measure: product.measure || 'Unidad'
          });
        }
        comanda.status = 'draft';
        comanda.updatedAt = new Date().toISOString();
        saveDB();
        redraw();
      },
      updateQty(index, delta) {
        const comanda = selectedTableId ? getActiveComandaByTable(db, selectedTableId) : null;
        if (!comanda || !comanda.items[index]) return;
        const newQty = Number((Number(comanda.items[index].qty) + delta).toFixed(3));
        if (newQty <= 0) {
          comanda.items.splice(index, 1);
        } else {
          comanda.items[index].qty = newQty;
        }
        comanda.updatedAt = new Date().toISOString();
        if (comanda.items.length === 0) comanda.status = 'draft';
        saveDB();
        redraw();
      },
      removeItem(index) {
        const comanda = selectedTableId ? getActiveComandaByTable(db, selectedTableId) : null;
        if (!comanda || !comanda.items[index]) return;
        comanda.items.splice(index, 1);
        comanda.updatedAt = new Date().toISOString();
        if (comanda.items.length === 0) comanda.status = 'draft';
        saveDB();
        redraw();
      },
      sendOrder() {
        const comanda = selectedTableId ? getActiveComandaByTable(db, selectedTableId) : null;
        if (!comanda || comanda.items.length === 0) {
          showToast('Agrega productos antes de enviar', 'error');
          return;
        }
        comanda.status = 'sent';
        comanda.sentAt = new Date().toISOString();
        comanda.updatedAt = new Date().toISOString();
        saveDB();
        showToast(`Pedido enviado: ${selectedTableId}`);
        redraw();
      },
      sendToPOS() {
        const comanda = selectedTableId ? getActiveComandaByTable(db, selectedTableId) : null;
        if (!comanda || comanda.items.length === 0) {
          showToast('No hay pedido para mandar', 'error');
          return;
        }
        comanda.status = 'sent';
        comanda.sentAt = comanda.sentAt || new Date().toISOString();
        comanda.updatedAt = new Date().toISOString();
        saveDB();
        loadOrderToPos(selectedTableId);
      },
      clearOrder() {
        const comanda = selectedTableId ? getActiveComandaByTable(db, selectedTableId) : null;
        if (!comanda) return;
        comanda.items = [];
        comanda.status = 'draft';
        comanda.updatedAt = new Date().toISOString();
        saveDB();
        redraw();
      }
    };

    redraw();
  }

  function getPendingOrders(db) {
    ensureData(db);
    return db.waiterModule.comandas.filter((c) => ['sent', 'loaded'].includes(c.status) && c.items?.length);
  }

  function markOrderLoaded(db, tableId) {
    const comanda = getActiveComandaByTable(db, tableId);
    if (!comanda) return;
    comanda.status = 'loaded';
    comanda.loadedAt = new Date().toISOString();
    comanda.updatedAt = new Date().toISOString();
  }

  function closeOrder(db, tableId) {
    const comanda = getActiveComandaByTable(db, tableId);
    if (!comanda) return;
    comanda.status = 'closed';
    comanda.closedAt = new Date().toISOString();
    comanda.updatedAt = new Date().toISOString();
    comanda.items = [];
  }

  window.WaitersModule = {
    ensureData,
    render,
    getPendingOrders,
    getActiveComandaByTable,
    markOrderLoaded,
    closeOrder,
    toCartItems
  };
})();
