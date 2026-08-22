import 'dart:async';

import 'package:battery_plus/battery_plus.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import 'pin_gate.dart';

class FamilyLocation {
  const FamilyLocation({
    required this.memberId,
    required this.familyId,
    required this.position,
    required this.displayName,
    required this.batteryLevel,
    required this.updatedAt,
    this.avatarUrl,
  });

  final String memberId;
  final String familyId;
  final LatLng position;
  final String displayName;
  final int batteryLevel;
  final DateTime? updatedAt;
  final String? avatarUrl;

  factory FamilyLocation.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> snapshot,
  ) {
    final data = snapshot.data() ?? const <String, dynamic>{};
    final timestamp = data['updatedAt'];
    return FamilyLocation(
      memberId: data['memberId'] as String? ?? snapshot.id,
      familyId: data['familyId'] as String? ?? 'unknown',
      position: LatLng(
        (data['latitude'] as num?)?.toDouble() ?? 0,
        (data['longitude'] as num?)?.toDouble() ?? 0,
      ),
      displayName: data['displayName'] as String? ?? 'Family member',
      batteryLevel: (data['batteryLevel'] as num?)?.toInt() ?? 0,
      updatedAt: timestamp is Timestamp ? timestamp.toDate() : null,
      avatarUrl: data['avatarUrl'] as String?,
    );
  }
}

class TrackerMap extends StatefulWidget {
  const TrackerMap({
    super.key,
    required this.familyId,
    this.onOpenPaywall,
  });

  final String familyId;
  final VoidCallback? onOpenPaywall;

  @override
  State<TrackerMap> createState() => _TrackerMapState();
}

class _TrackerMapState extends State<TrackerMap> {
  static const _defaultCenter = LatLng(43.6532, -79.3832);
  static const _mapStyle = '''[
    {"elementType":"geometry","stylers":[{"color":"#182522"}]},
    {"elementType":"labels.text.fill","stylers":[{"color":"#8fa6a0"}]},
    {"elementType":"labels.text.stroke","stylers":[{"color":"#182522"}]},
    {"featureType":"administrative","elementType":"geometry","stylers":[{"color":"#2b413b"}]},
    {"featureType":"poi","elementType":"geometry","stylers":[{"color":"#1c302b"}]},
    {"featureType":"road","elementType":"geometry","stylers":[{"color":"#2d433d"}]},
    {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#3d5a50"}]},
    {"featureType":"transit.line","elementType":"geometry","stylers":[{"color":"#294038"}]},
    {"featureType":"water","elementType":"geometry","stylers":[{"color":"#0d1b24"}]}
  ]''';

  final _battery = Battery();
  StreamSubscription<Position>? _locationSubscription;
  GoogleMapController? _mapController;
  LatLng _cameraTarget = _defaultCenter;
  String? _locationMessage;

  CollectionReference<Map<String, dynamic>> get _locations =>
      FirebaseFirestore.instance.collection('family_locations');

  @override
  void initState() {
    super.initState();
    _startLocationSharing();
  }

  Future<void> _startLocationSharing() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      if (mounted) {
        setState(() => _locationMessage =
            'Turn on Location Services to share your location.');
      }
      return;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      if (mounted) {
        setState(() => _locationMessage =
            'Location permission is required for live sharing.');
      }
      return;
    }

    const settings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    );
    _locationSubscription = Geolocator.getPositionStream(
      locationSettings: settings,
    ).listen(_publishLocation);

    try {
      final current = await Geolocator.getCurrentPosition(
        locationSettings: settings,
      );
      await _publishLocation(current);
    } catch (error) {
      if (mounted) {
        setState(() => _locationMessage =
            'Could not read your current location: $error');
      }
    }
  }

  Future<void> _publishLocation(Position position) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    final batteryLevel = await _battery.batteryLevel;
    final locationData = <String, dynamic>{
      'familyId': widget.familyId,
      'memberId': user.uid,
      'displayName': 'You',
      'latitude': position.latitude,
      'longitude': position.longitude,
      'batteryLevel': batteryLevel,
      'updatedAt': FieldValue.serverTimestamp(),
      'reportedAt': Timestamp.now(),
    };

    final latestRef = _locations.doc(user.uid);
    final historyRef = latestRef.collection('route_history').doc();
    final batch = FirebaseFirestore.instance.batch();
    batch.set(latestRef, locationData, SetOptions(merge: true));
    batch.set(historyRef, locationData);
    await batch.commit();

    final nextTarget = LatLng(position.latitude, position.longitude);
    if (!mounted) return;
    setState(() {
      _cameraTarget = nextTarget;
      _locationMessage = null;
    });
    _mapController?.animateCamera(CameraUpdate.newLatLng(nextTarget));
  }

  Future<void> _openMember(FamilyLocation member) async {
    if (!await requireFamilyPin(
      context,
      title: 'Unlock ${member.displayName}',
    )) {
      return;
    }
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => MemberProfileSheet(
        member: member,
        onOpenPaywall: widget.onOpenPaywall,
      ),
    );
  }

  Future<void> _openSettings() async {
    if (!await requireFamilyPin(context, title: 'Unlock settings')) return;
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      useSafeArea: true,
      builder: (context) => const SafeArea(
        child: Padding(
          padding: EdgeInsets.fromLTRB(24, 8, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Settings', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
              SizedBox(height: 18),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.notifications_active_outlined),
                title: Text('Location alerts'),
                subtitle: Text('Manage arrival and low-battery notifications.'),
              ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.family_restroom_rounded),
                title: Text('Family members'),
                subtitle: Text('Invite and manage trusted family members.'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Set<Marker> _markersFor(List<FamilyLocation> members) {
    final currentUid = FirebaseAuth.instance.currentUser?.uid;
    return members
        .where((member) =>
            member.position.latitude != 0 || member.position.longitude != 0)
        .map(
          (member) => Marker(
            markerId: MarkerId(member.memberId),
            position: member.position,
            icon: BitmapDescriptor.defaultMarkerWithHue(
              member.memberId == currentUid
                  ? BitmapDescriptor.hueAzure
                  : BitmapDescriptor.hueRose,
            ),
            infoWindow: InfoWindow(
              title: member.displayName,
              snippet: '${member.batteryLevel}% battery',
            ),
            onTap: () => _openMember(member),
          ),
        )
        .toSet();
  }

  @override
  void dispose() {
    _locationSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _locations.where('familyId', isEqualTo: widget.familyId);
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Family live map',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: [
          IconButton(
            tooltip: 'Family Pro',
            onPressed: widget.onOpenPaywall,
            icon: const Icon(Icons.workspace_premium_outlined),
          ),
          IconButton(
            tooltip: 'Settings',
            onPressed: _openSettings,
            icon: const Icon(Icons.tune_rounded),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: query.snapshots(),
        builder: (context, snapshot) {
          final members = snapshot.data?.docs
                  .map(FamilyLocation.fromFirestore)
                  .toList(growable: false) ??
              const <FamilyLocation>[];
          return Stack(
            children: [
              GoogleMap(
                initialCameraPosition: CameraPosition(
                  target: _cameraTarget,
                  zoom: 12.5,
                ),
                onMapCreated: (controller) {
                  _mapController = controller;
                  controller.setMapStyle(_mapStyle);
                },
                myLocationEnabled: true,
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                mapToolbarEnabled: false,
                compassEnabled: true,
                markers: _markersFor(members),
              ),
              if (_locationMessage != null)
                Positioned(
                  top: MediaQuery.paddingOf(context).top + 76,
                  left: 16,
                  right: 16,
                  child: Material(
                    color: const Color(0xE61C302B),
                    borderRadius: BorderRadius.circular(16),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(_locationMessage!),
                    ),
                  ),
                ),
              Positioned(
                right: 16,
                bottom: 214,
                child: FloatingActionButton.small(
                  heroTag: 'center-map',
                  onPressed: () => _mapController?.animateCamera(
                    CameraUpdate.newLatLng(_cameraTarget),
                  ),
                  child: const Icon(Icons.my_location_rounded),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _MemberDrawer(
                  members: members,
                  onMemberTap: _openMember,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _MemberDrawer extends StatelessWidget {
  const _MemberDrawer({required this.members, required this.onMemberTap});

  final List<FamilyLocation> members;
  final ValueChanged<FamilyLocation> onMemberTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xF20F1C1A),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Everyone',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                    ),
                  ),
                  Text(
                    '${members.length} sharing',
                    style: const TextStyle(color: Colors.white54),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 94,
                child: members.isEmpty
                    ? const Center(
                        child: Text(
                          'Waiting for family locations…',
                          style: TextStyle(color: Colors.white54),
                        ),
                      )
                    : ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: members.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 10),
                        itemBuilder: (context, index) {
                          final member = members[index];
                          return _MemberChip(
                            member: member,
                            onTap: () => onMemberTap(member),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MemberChip extends StatelessWidget {
  const _MemberChip({required this.member, required this.onTap});

  final FamilyLocation member;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hasAvatar = member.avatarUrl != null && member.avatarUrl!.isNotEmpty;
    final initial = member.displayName.isEmpty
        ? '?'
        : member.displayName.substring(0, 1).toUpperCase();
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: 78,
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: const Color(0xFF182925),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(
              radius: 23,
              backgroundImage: hasAvatar ? NetworkImage(member.avatarUrl!) : null,
              child: hasAvatar ? null : Text(initial),
            ),
            const SizedBox(height: 6),
            Text(
              member.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }
}

class MemberProfileSheet extends StatelessWidget {
  const MemberProfileSheet({
    super.key,
    required this.member,
    this.onOpenPaywall,
  });

  final FamilyLocation member;
  final VoidCallback? onOpenPaywall;

  String get _lastSeen {
    final updatedAt = member.updatedAt;
    if (updatedAt == null) return 'Updating now';
    final age = DateTime.now().difference(updatedAt);
    if (age.inSeconds < 60) return 'Updated just now';
    if (age.inMinutes < 60) return 'Updated ${age.inMinutes}m ago';
    return 'Updated ${age.inHours}h ago';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasAvatar = member.avatarUrl != null && member.avatarUrl!.isNotEmpty;
    final initial = member.displayName.isEmpty
        ? '?'
        : member.displayName.substring(0, 1).toUpperCase();
    return Material(
      color: const Color(0xFF0F1C1A),
      borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 14, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 42, height: 4, color: Colors.white24),
              const SizedBox(height: 24),
              CircleAvatar(
                radius: 42,
                backgroundImage: hasAvatar ? NetworkImage(member.avatarUrl!) : null,
                child: hasAvatar ? null : Text(initial, style: const TextStyle(fontSize: 28)),
              ),
              const SizedBox(height: 12),
              Text(
                member.displayName,
                style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
              ),
              Text(_lastSeen, style: const TextStyle(color: Colors.white54)),
              const SizedBox(height: 22),
              Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      icon: Icons.battery_6_bar_rounded,
                      label: 'Battery',
                      value: '${member.batteryLevel}%',
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: _StatCard(
                      icon: Icons.location_on_outlined,
                      label: 'Status',
                      value: 'Live',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onOpenPaywall,
                icon: const Icon(Icons.route_rounded),
                label: const Text('View 30-day route history'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF182925),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(icon, size: 22),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.white54, fontSize: 12)),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
        ],
      ),
    );
  }
}

