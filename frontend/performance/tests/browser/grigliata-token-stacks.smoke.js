const { test, expect } = require('@playwright/test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { operationReceiptId } = require('../../../functions/lib/userDataV2');
const { configureOwnedPerformanceEnvironment, projectId } = require('../../../scripts/performance/common');
const { installBootstrap, installDeterministicFontRoutes, storageStateForRole, waitForReadiness } = require('./helpers');

async function panPickerOverTurnOrder(page, badge, option) {
  const scrollBox = await page.getByTestId('turn-order-scroll-container').boundingBox();
  const optionBox = await option.boundingBox();
  const board = await page.locator('.konvajs-content').boundingBox();
  const x = board.x + board.width * 0.4;
  const y = board.y + board.height / 2;
  const dx = scrollBox.x + 48 - (optionBox.x + optionBox.width / 2);
  const dy = scrollBox.y + 42 - (optionBox.y + optionBox.height / 2);

  await page.keyboard.press('Escape');
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await badge.click();

  // Both controls occupy this pixel. The pointer must reach the visible option.
  const hit = await option.evaluate(button => {
    const box = button.getBoundingClientRect();
    const elements = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      overTurnOrder: elements.includes(document.querySelector('[data-testid="turn-order-scroll-container"]')),
      hitsOption: button.contains(elements[0]),
    };
  });
  expect(hit).toEqual({ overTurnOrder: true, hitsOption: true });
}

async function dragCoveredToken({ context, page, role }) {
  configureOwnedPerformanceEnvironment();
  const app = initializeApp({ projectId }, `grigliata-token-stack-${role}`);
  const db = getFirestore(app);
  const background = db.doc('grigliata_backgrounds/perf-map');
  const lowerId = 'perf-token-0000';
  const upperId = 'perf-token-0001';
  const lower = db.doc(`grigliata_token_placements/perf-map__${lowerId}`);
  const upper = db.doc(`grigliata_token_placements/perf-map__${upperId}`);
  const owner = `perf-${role}`;
  const lowerProfile = db.doc(`grigliata_tokens/${lowerId}`);
  const originals = await db.getAll(background, lower, upper, lowerProfile, db.doc(`users/${owner}/state/settings`));
  let movementReceipt;
  const cell = { col: 45, row: 45 };
  const delta = { col: 4, row: 2 };

  try {
    const setup = db.batch();
    setup.update(background, { fogOfWarEnabled: false, tokenLayerOrder: [lowerId, upperId] });
    setup.update(lower, { ...cell, ownerUid: owner });
    setup.update(upper, cell);
    setup.update(lowerProfile, { ownerUid: owner });
    await setup.commit();

    await installDeterministicFontRoutes(context);
    await installBootstrap(context, { id: 'grigliata-token-stacks', role }, 1);
    await page.goto('/grigliata');
    await waitForReadiness(page);
    const badge = page.getByRole('button', { name: /2 pedine sovrapposte/i });
    await badge.click();
    const picker = page.getByRole('dialog', { name: 'Pedine sovrapposte' });
    await expect(picker.getByTestId(`token-stack-option-${upperId}`)).toBeDisabled();
    const ownOption = picker.getByTestId(`token-stack-option-${lowerId}`);
    await panPickerOverTurnOrder(page, badge, ownOption);
    await ownOption.click();

    // Locate the shared cell in the rendered map. Mouse input still traverses
    // the DOM overlays and Konva's real hit canvas before it reaches the board.
    const { from, to } = await page.evaluate(({ upperId, cellSize, delta }) => {
      const stage = window.Konva.stages.find(stage => stage.findOne(node => (
        node.getAttr('data-testid') === `token-node-${upperId}`
      )));
      const token = stage.findOne(node => node.getAttr('data-testid') === `token-node-${upperId}`);
      const rect = stage.container().getBoundingClientRect();
      const clientPoint = (col, row) => {
        const point = token.getAbsoluteTransform().point({ x: (col + 0.5) * cellSize, y: (row + 0.5) * cellSize });
        return { x: rect.left + point.x, y: rect.top + point.y };
      };
      return { from: clientPoint(0, 0), to: clientPoint(delta.col, delta.row) };
    }, { upperId, cellSize: originals[0].get('grid.cellSizePx'), delta });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    const [save] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/task05UpdateSettings'), { timeout: 60000 }),
      page.mouse.up(),
    ]);
    movementReceipt = db.collection('user_operations').doc(operationReceiptId(owner, save.request().postDataJSON().data.operationId));
    const result = await save.json();
    expect(result).toMatchObject({ result: { success: true } });

    await expect.poll(async () => (await lower.get()).data()).toMatchObject({ col: cell.col + delta.col, row: cell.row + delta.row });
    expect((await upper.get()).data()).toMatchObject(cell);
    await expect(page.getByRole('button', { name: /2 pedine sovrapposte/i })).toHaveCount(0);
  } finally {
    try {
      await page.close();
      const restore = db.batch();
      originals.forEach(snapshot => {
        if (snapshot.exists) restore.set(snapshot.ref, snapshot.data());
        else restore.delete(snapshot.ref);
      });
      if (movementReceipt) restore.delete(movementReceipt);
      await restore.commit();
    } finally {
      await deleteApp(app);
    }
  }
}

for (const role of ['player', 'webmaster']) {
  test.describe(role, () => {
    test.use({ storageState: storageStateForRole(role) });
    test('drags their token out from under another player’s token', ({ context, page }) => (
      dragCoveredToken({ context, page, role })
    ));
  });
}
