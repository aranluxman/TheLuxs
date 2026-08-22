import 'dart:async';

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

class PaywallScreen extends StatefulWidget {
  const PaywallScreen({super.key});

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> {
  static const productId = 'family_pro_monthly';

  final _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;
  ProductDetails? _product;
  String? _error;
  bool _storeAvailable = false;
  bool _loading = true;
  bool _pending = false;
  bool _isPro = false;

  @override
  void initState() {
    super.initState();
    _purchaseSubscription = _iap.purchaseStream.listen(
      _onPurchaseUpdate,
      onError: (Object error) {
        if (mounted) setState(() => _error = error.toString());
      },
    );
    _loadProduct();
  }

  Future<void> _loadProduct() async {
    final available = await _iap.isAvailable();
    if (!available) {
      if (mounted) {
        setState(() {
          _storeAvailable = false;
          _loading = false;
          _error = 'The App Store or Google Play is unavailable on this device.';
        });
      }
      return;
    }

    final response = await _iap.queryProductDetails({productId});
    if (!mounted) return;
    setState(() {
      _storeAvailable = true;
      _loading = false;
      _product = response.productDetails.isEmpty
          ? null
          : response.productDetails.first;
      _error = response.error?.message ??
          (response.notFoundIDs.isNotEmpty
              ? 'Create the $productId subscription in both store consoles first.'
              : null);
    });
  }

  Future<void> _buy() async {
    final product = _product;
    if (product == null) return;
    setState(() {
      _pending = true;
      _error = null;
    });
    await _iap.buyNonConsumable(
      purchaseParam: PurchaseParam(productDetails: product),
    );
  }

  Future<void> _onPurchaseUpdate(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      if (purchase.productID != productId) continue;

      if (purchase.status == PurchaseStatus.pending) {
        if (mounted) setState(() => _pending = true);
      } else if (purchase.status == PurchaseStatus.purchased ||
          purchase.status == PurchaseStatus.restored) {
        // Production apps should verify the platform receipt on a trusted server
        // before granting long-lived entitlements. This sample unlocks the UI
        // after the store reports a completed transaction.
        if (mounted) {
          setState(() {
            _pending = false;
            _isPro = true;
          });
        }
      } else if (purchase.status == PurchaseStatus.error) {
        if (mounted) {
          setState(() {
            _pending = false;
            _error = purchase.error?.message ?? 'Purchase failed.';
          });
        }
      } else if (purchase.status == PurchaseStatus.canceled) {
        if (mounted) setState(() => _pending = false);
      }

      if (purchase.pendingCompletePurchase) {
        await _iap.completePurchase(purchase);
      }
    }
  }

  @override
  void dispose() {
    _purchaseSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final price = _product?.price ?? r'$4.99';

    return Scaffold(
      appBar: AppBar(title: const Text('Family Pro')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    theme.colorScheme.primaryContainer,
                    const Color(0xFF1C3833),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(28),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.workspace_premium_rounded,
                    color: theme.colorScheme.primary,
                    size: 42,
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'More context. Less worry.',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Keep your family connected with thoughtful location history and alerts.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const _FeatureRow(
              icon: Icons.route_rounded,
              title: '30-day route history',
              subtitle: 'Replay trips and understand patterns.',
            ),
            const _FeatureRow(
              icon: Icons.place_rounded,
              title: 'Unlimited place alerts',
              subtitle: 'Know when someone arrives or leaves.',
            ),
            const _FeatureRow(
              icon: Icons.battery_alert_rounded,
              title: 'Low-battery alerts',
              subtitle: 'Get notified before a phone goes offline.',
            ),
            const SizedBox(height: 18),
            Text(
              '$price / month',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            FilledButton(
              onPressed: (!_storeAvailable || _product == null || _pending)
                  ? null
                  : (_isPro ? null : _buy),
              child: _pending
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_isPro ? 'Family Pro is active' : 'Start Family Pro'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _restore,
              child: const Text('Restore purchases'),
            ),
            const SizedBox(height: 12),
            const Text(
              'Subscriptions renew automatically until canceled in your store account. Store products and receipt verification must be configured before release.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white54),
            ),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 20),
                child: Center(child: CircularProgressIndicator()),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _restore() async {
    await _iap.restorePurchases();
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 23,
            backgroundColor: Theme.of(context).colorScheme.primaryContainer,
            child: Icon(icon),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
                Text(subtitle, style: const TextStyle(color: Colors.white60)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

