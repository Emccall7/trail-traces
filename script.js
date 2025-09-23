    // ✅ Global Variable to Track Selected Postcard and Initial Load
    let selectedPostcardID = null;
    let initialLoad = true; // ✅ Track if it's the first load

    // ✅ Toggle between Map View and Gallery View
    const galleryButton = document.getElementById('toggle-gallery');
    const mapView = document.getElementById('map');
    const galleryView = document.getElementById('gallery-view');


    // ✅ Switch between views
    galleryButton.addEventListener('click', function() {
        const isGalleryVisible = galleryView.style.display === 'flex';

        if (isGalleryVisible) {
            // when switching to Map
            galleryView.style.display = 'none';
            mapView.style.display = 'block';
            galleryButton.textContent = 'View Gallery';
            gtag('event', 'toggle_view', {
                'event_category': 'Interaction',
                'event_label': 'Switched to Map'
            });

            if (selectedPostcardID) {
                const marker = markerById.get(selectedPostcardID);
                const markerVisible = !!(marker && markers.hasLayer(marker));
                console.log('[view switch] selected:', selectedPostcardID, '| markerVisible?', markerVisible);

                // Only try to highlight/pan if the marker is currently in the cluster (i.e., not filtered out)
                if (markerVisible) {
                    highlightMarker(selectedPostcardID);
                    const postcard = postcards.find(p => p.postcardID === selectedPostcardID);
                    if (postcard) panToMarker(postcard);
                } else {
                    console.log('[view switch] marker hidden by filter or missing; skipping pan.');
                }
            }
        } else {
            console.log("Switching to Gallery View");
            galleryView.style.display = 'flex';
            mapView.style.display = 'none';
            galleryButton.textContent = 'View Map';
            populateGallery();
            highlightSelectedCard(); // ✅ Highlight in Gallery
            gtag('event', 'toggle_view', {
                'event_category': 'Interaction',
                'event_label': 'Switched to Gallery'
            });
        }
    });


    // ✅ Function to Highlight the Selected Card in Gallery
    function highlightSelectedCard() {
        document.querySelectorAll('.gallery-card').forEach(card => {
            card.classList.remove('selected');
        });

        const selectedCard = document.querySelector(`.gallery-card img[src*="${selectedPostcardID}_F.jpg"]`);
        if (selectedCard) {
            selectedCard.parentElement.classList.add('selected');
        }
    }

    // Helper: strip "tag@size@pos | tag2@..." → "tag tag2"
    function stripTagQualifiers(str = "") {
    return String(str)
        .split("|")
        .map(s => s.split("@")[0])
        .map(s => s.trim())
        .filter(Boolean)
        .join(" ");
    }

    // ✅ Updating the sidebar function to use async for the image
    async function updateSidebar(data, { forceReveal = false } = {}) {
    if (!data) {
        document.getElementById('sidebar-content').innerHTML =
        `<p>Select a marker or postcard to view details here.</p>`;
        return;
    }

    // GATE: if mature and not opted-in and not forced
    if (data.isMature && !showMature && !forceReveal) {
    const sidebarContent = document.getElementById('sidebar-content');
    const imgURL = showBacks
        ? (data.imageBackURL || getS3ImageURL(data.postcardID, 'B'))
        : (data.imageFrontURL || getS3ImageURL(data.postcardID, 'F'));

    sidebarContent.innerHTML = `
        <div class="gate">
        <div class="gate-hero">
            <img class="gate-image blurred" src="${imgURL}" alt="Mature postcard preview (blurred)">
        </div>
        <p>This postcard is marked as <strong>18+ Mature</strong>. It may contain profanity, sexual themes, explicit language, or other adult material.</p>
        <div class="gate-actions">
            <button id="reveal-this" type="button">Continue to view</button>
        </div>
        </div>
    `;

    // Only the button reveals (no click on image/hero)
    document.getElementById('reveal-this').addEventListener('click', () => {
        updateSidebar(data, { forceReveal: true });
        if (typeof gtag === "function") {
        gtag('event', 'mature_reveal_sidebar_once', { event_category: 'Filter' });
        }
    });

    return; // stop here; user must choose
    }


    // 👇 Normal (non-gated) sidebar render
    const displayName = data.anonymous === 'Y' ? 'Anonymous' : data.name;
    const sc = document.getElementById('sidebar-content');
    sc.innerHTML = `
        <div class="postcard-container">
        <img id="postcard-image" class="postcard-image"
            src="${showBacks ? (data.imageBackURL || getS3ImageURL(data.postcardID,'B'))
                                : (data.imageFrontURL || getS3ImageURL(data.postcardID,'F'))}"
            alt="Postcard Image">
        ${data.imageBackURL ? `<button id="flip-button" class="flip-btn">⇆</button>` : ""}
        <button id="rotate-button" class="rotate-btn">↻</button>
        </div>

        <p><strong>From:</strong> <span id="postcard-name">${displayName}</span></p>
        <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted || 'Not Available'}</span></p>
        <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted}</span></p>

        <div class="share-buttons">
        <button id="copy-link" class="share-btn">Share</button>
        </div>
    `;

    // handlers
    const rotateButton = document.getElementById("rotate-button");
    if (rotateButton) rotateButton.addEventListener("click", rotatePostcard);

    const flipButton = document.getElementById('flip-button');
    const postcardImage = document.getElementById('postcard-image');
    if (flipButton && postcardImage && data.imageBackURL) {
        let showingFront = !showBacks;
        flipButton.style.display = "block";
        flipButton.addEventListener('click', function () {
        showingFront = !showingFront;
        postcardImage.src = showingFront
            ? (data.imageFrontURL || getS3ImageURL(data.postcardID,'F'))
            : (data.imageBackURL  || getS3ImageURL(data.postcardID,'B'));
        });
    }

    const copyButton = document.getElementById('copy-link');
    if (copyButton) {
        copyButton.addEventListener('click', () => {
        const link = `${window.location.origin}${window.location.pathname}?id=${data.postcardID}`;
        navigator.clipboard.writeText(link)
            .then(() => {
            alert("Link copied to clipboard!");
            if (typeof gtag === "function") {
                gtag('event', 'share_link', { event_category: 'Interaction', event_label: 'Copied Link' });
            }
            })
            .catch(err => console.error("Error copying link: ", err));
        });
    }

    updateURL(data.postcardID);
    }







    ///////////////////////////////////////////



    // ✅ Define the bounding box for the PCT region
    const pctBounds = [
        [25, -140], // Southwest corner
        [55, -100]  // Northeast corner
    ];

    // ✅ Initialize the map with set boundaries and zoom constraints
    const map = L.map('map', {
        minZoom: 5,
        maxZoom: 16,
        maxBounds: pctBounds,  // Restrict panning
        maxBoundsViscosity: 0.8, // Adds resistance when nearing boundaries
        zoomControl: false
    }).setView([42, -120], 5);

    // ✅ Optional: Prevent "bouncing" when hitting the edges
    map.options.worldCopyJump = false;
    map.options.inertia = false;

    // ✅ Load CartoDB Positron (Base Layer with Labels)
    const cartoBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 18
    }).addTo(map);

    // ✅ Load Full PCT Trail (Below Hillshade & Above Carto)
    fetch('data/Full_PCT.geojson')
        .then(res => res.json())
        .then(pct => {
            const pctTrail = L.geoJSON(pct, {
                style: {
                    color: '#008286',  // ✅ Blue shade for subtlety
                    weight: 2,         // ✅ Lighter line weight
                    opacity: 0.6       // ✅ Semi-transparent for better blending
                }
            }).addTo(map);

            // ✅ Ensure the trail stays **below** the hillshade
            cartoBasemap.bringToBack();
            pctTrail.bringToBack();
        })
        .catch(err => console.error("Error loading PCT trail:", err));

    // ✅ Overlay Esri Hillshade (Topmost Layer for Terrain)
    const hillshadeLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, USGS, NASA',
        opacity: 0.5,  // ✅ Adjust transparency for balance
        maxZoom: 16
    }).addTo(map);


    // ✅ Define Amazon S3 Bucket Base URL
    const S3_BASE_URL = "https://trail-traces-images.s3.us-east-2.amazonaws.com/";

    // ✅ Google Sheets CSV URL
    const sheetURL = "https://docs.google.com/spreadsheets/d/1-AHY6y5Sv9k02kV7dOcxbyZrt-d1dMBhlMlYCEA5gH4/export?format=csv&gid=0";


    // ✅ Track active marker
    let activeMarker = null;
    const postcards = [];
    const postcardsById = new Map();
    const markerById = new Map(); // postcardID -> Leaflet marker
    const allowSearchAnonNames = false;

    // ✅ Function to ensure image URLs follow S3 naming convention (.jpg or .JPG)
    function getS3ImageURL(postcardID, type) {
        const lowerCaseURL = `${S3_BASE_URL}${postcardID}_${type}.jpg`;
        const upperCaseURL = `${S3_BASE_URL}${postcardID}_${type}.JPG`;

        // ✅ Create an Image object to test loading
        const testImage = new Image();
        testImage.src = lowerCaseURL;

        // ✅ If it loads, return it; if not, fallback to .JPG
        testImage.onerror = () => {
            testImage.src = upperCaseURL;
        };

        return testImage.src;
    }

    // ✅ Function to update the URL with the selected postcard ID
    function updateURL(postcardID) {
        const newURL = `${window.location.origin}${window.location.pathname}?id=${postcardID}`;
        window.history.pushState({ path: newURL }, '', newURL);
    }

    // ✅ Function to get postcard ID from URL
    function getPostcardIDFromURL() {
        const params = new URLSearchParams(window.location.search);
        return params.get("id");
    }

    // ✅ Function to copy the current URL to clipboard
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert("Link copied to clipboard!");
        }).catch(err => console.error("Error copying to clipboard:", err));
    }

    // ✅ Generate Share Button with Correct Class
    function generateShareButton(postcardID) {
        return `<button id="copy-link" class="share-btn">Share</button>`;
    }

    // ✅ Initialize Marker Cluster Group (Ensure Postcards Stay Above Everything Else)
    const markers = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 40
    });
    

    // ✅ Fetch and Load Postcards
    fetch(sheetURL)
        .then(response => response.text())
        .then(csvText => {
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

            parsed.data.forEach(row => {

                // ...inside your `parsed.data.forEach(row => { ... })`:
                const postcardID  = row["postcardID"]?.trim();
                if (!postcardID) return;

                const rawLat = row["Latitude"];
                const rawLon = row["Longitude"];
                const lat = Number.isFinite(parseFloat(rawLat)) ? parseFloat(rawLat) : null;
                const lon = Number.isFinite(parseFloat(rawLon)) ? parseFloat(rawLon) : null;

                const placePosted = row["PlacePosted"]?.trim() || "Not Available";
                const datePosted  = row["DatePosted"]?.trim() || "Unknown Date";
                const name        = row["Name"]?.trim() || "Unknown";
                const anonymous   = row["Anonymous"]?.trim() || "N";
                const isMature    = (row["Mature"]?.trim()?.toUpperCase() === "Y");

                const rawName = row["Name"]?.trim() || "";
                const nameForIndex =
                (!allowSearchAnonNames && anonymous === 'Y') ? '' :
                (rawName.toLowerCase() === 'unknown' ? '' : rawName);

                // NEW searchable fields
                const cleanTextF  = (row["CleanText_F"]  || "").trim();
                const cleanTextB  = (row["CleanText_B"]  || "").trim();
                const visualTagsF = stripTagQualifiers(row["VisualTags_F"] || "");
                const visualTagsB = stripTagQualifiers(row["VisualTags_B"] || "");

                const imageFrontURL = getS3ImageURL(postcardID, "F");
                const imageBackURL  = getS3ImageURL(postcardID, "B");

                const postcardData = {
                postcardID,
                placePosted,
                datePosted,
                imageFrontURL,
                imageBackURL,
                name,
                anonymous,
                lat, lon,
                hasCoords: Number.isFinite(lat) && Number.isFinite(lon),
                isMature,
                // searchable
                cleanTextF, cleanTextB, visualTagsF, visualTagsB,
                nameIndex: nameForIndex
                };

                postcards.push(postcardData);
                postcardsById.set(postcardID, postcardData);

                // marker (same as before)
                if (postcardData.hasCoords) {
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({
                    html: `<div class="custom-marker" data-id="${postcardID}"></div>`,
                    className: 'custom-marker-container',
                    iconSize: [15, 15]
                    })
                });
                markerById.set(postcardID, marker);

                marker.on('click', () => {
                    updateSidebar(postcardData);
                    highlightMarker(postcardID);
                    selectedPostcardID = postcardID;
                });
                markers.addLayer(marker);
                
                markerById.set(postcardID, marker);
                }

            });
            
            buildSearchIndex();   // build from the filled `postcards` array
            sortPostcards();
            map.addLayer(markers);
            populateGallery();
            setTimeout(() => { selectPostcardFromURL(); }, 500);


            // sort immediately after loading
            sortPostcards();

            // ensure URL selection happens after loading
            setTimeout(() => {
                selectPostcardFromURL();
            }, 500);


            // ✅ Function to Sort Postcards (Used Immediately After Loading)
            function sortPostcards() {
                postcards.sort((a, b) => {
                    if (sortOrder === "date-desc") {
                        return new Date(b.datePosted) - new Date(a.datePosted);
                    } else if (sortOrder === "date-asc") {
                        return new Date(a.datePosted) - new Date(b.datePosted);
                    } else if (sortOrder === "south-north-asc") {
                        return parseFloat(a.lat) - parseFloat(b.lat);
                    } else if (sortOrder === "south-north-desc") {
                        return parseFloat(b.lat) - parseFloat(a.lat);
                    } else if (sortOrder === "recent-asc") {
                        return parseInt(a.postcardID) - parseInt(b.postcardID);
                    } else if (sortOrder === "recent-desc") {
                        return parseInt(b.postcardID) - parseInt(a.postcardID);
                    }
                    return 0; // Default no sort
                });
                console.log("Postcards Sorted:", sortOrder, postcards);
            }

            map.addLayer(markers);

            // ✅ Ensure postcards are fully loaded before selecting a random one
            setTimeout(() => {
                selectPostcardFromURL();
            }, 500);
        })
        .catch(error => console.error("Error loading postcard data:", error));

    // ✅ Function to Select Postcard from URL with Initial Load Flag
    function selectPostcardFromURL(initialLoad = false) {
        const params = new URLSearchParams(window.location.search);
        const postcardID = params.get("id");

        if (postcardID) {
            const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
            if (selectedPostcard) {
                selectPostcard(selectedPostcard, initialLoad);
            } else {
                console.warn("Postcard ID in URL not found. Selecting random postcard.");
                selectRandomPostcard(initialLoad);
            }
        } else {
            selectRandomPostcard(initialLoad);
        }
    }

    // ✅ Function to randomly select a postcard and display it
    function selectRandomPostcard() {
        if (postcards.length === 0) {
            console.warn("No postcards available to select.");
            return;
        }

        const randomPostcard = postcards[Math.floor(Math.random() * postcards.length)];
        console.log("Randomly Selected Postcard:", randomPostcard);

        selectPostcard(randomPostcard);
    }


    // ✅ Function to Highlight Active Marker
    function highlightMarker(postcardID) {
        if (!postcardID) return;
        document.querySelectorAll('.custom-marker').forEach(marker => {
            marker.classList.remove('selected');
            if (marker.dataset.id === postcardID) {
                marker.classList.add('selected');
            }
        });
    }


    // ✅ Function to Auto-Pan Map to Marker with Smooth FlyTo and Cluster Handling
    function panToMarker(postcard) {
        if (!postcard || !Number.isFinite(postcard.lat) || !Number.isFinite(postcard.lon)) {
            console.log("Postcard has no coordinates; skipping pan.");
            highlightMarker(postcard?.postcardID);
            return;
        }

        const marker = markerById.get(postcard.postcardID);
        // If the marker doesn't exist OR is currently filtered out of the cluster, don't try to fly.
        if (!marker || !markers.hasLayer(marker)) {
            console.log('panToMarker: marker missing or filtered out; skipping flyTo.');
            highlightMarker(postcard.postcardID);
            return;
        }

        const targetLatLng = marker.getLatLng();
        if (map.getBounds().contains(targetLatLng)) {
            highlightMarker(postcard.postcardID);
            marker.openPopup?.();
            return;
        }

        markers.zoomToShowLayer(marker, () => {
            map.flyTo(targetLatLng, map.getZoom(), {
            animate: true,
            duration: 1.5,
            easeLinearity: 0.25
            });
            setTimeout(() => {
            highlightMarker(postcard.postcardID);
            marker.openPopup?.();
            }, 500);
        });
        }




    // ✅ Ensure Marker Remains Highlighted after Clustering Updates
    markers.on('animationend', () => {
        if (selectedPostcardID) {
            highlightMarker(selectedPostcardID);
        }
    });

    const sidebarContent = document.getElementById('sidebar-content');
    sidebarContent.innerHTML = `<p>Loading postcards...</p>`;

    // function updateSidebar(data) {
    //     if (!data) {
    //         // ✅ If no postcard is selected yet, show this message
    //         document.getElementById('sidebar-content').innerHTML = `<p>Click on a marker in the map to view a postcard.</p>`;
    //         return;
    //     }

    //     const sidebarContent = document.getElementById('sidebar-content');
    //     sidebarContent.innerHTML = `
    //         <div class="postcard-container">
    //             <img id="postcard-image" class="postcard-image" src="${data.imageFrontURL}" alt="Postcard Image">
    //             ${data.imageBackURL ? `<button id="flip-button" class="flip-btn">⇆</button>` : ""}
    //         </div>

    //         <p><strong>From:</strong> <span id="postcard-name">${data.name}</span></p>
    //         <p><strong>Location:</strong> <span id="postcard-location">${data.placePosted}</span></p>
    //         <p><strong>Date:</strong> <span id="postcard-date">${data.datePosted}</span></p>

    //         <div class="share-buttons">
    //             <button id="copy-link" class="share-btn">Share</button>
    //         </div>
    //     `;

    //     updateURL(data.postcardID);
    //     highlightMarker(data.postcardID);

    //     // ✅ Ensure Flip Button Works
    //     const flipButton = document.getElementById('flip-button');
    //     const postcardImage = document.getElementById('postcard-image');

    //     if (flipButton && postcardImage) {
    //         let showingFront = true;
    //         flipButton.style.display = "block";

    //         flipButton.addEventListener('click', function () {
    //             showingFront = !showingFront;
    //             postcardImage.src = showingFront ? data.imageFrontURL : data.imageBackURL;
    //         });
    //     }

    //     // ✅ Copy Link Functionality
    //     document.getElementById('copy-link').addEventListener('click', () => {
    //         navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?id=${data.postcardID}`)
    //             .then(() => alert("Link copied to clipboard!"))
    //             .catch(err => console.error("Error copying to clipboard:", err));
    //     });
    // }






    // ✅ Toggle About Section
    document.getElementById("toggle-about").addEventListener("click", function () {
        const aboutContent = document.getElementById("about-content");
        aboutContent.classList.toggle("visible");
        this.textContent = aboutContent.classList.contains("visible") 
            ? "About This Project ▲" 
            : "About This Project ▼";
    });

    // ✅ FOR SIDEBAR:

    // ✅ Select elements
    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('toggle-sidebar');

    // ✅ Detect if user is on mobile
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // ✅ Set initial state (closed)
    let isExpanded = false;
    toggleButton.innerHTML = isMobile() ? '▲' : '▶'; // `›` for right, `▲` for up "▼

    // ✅ Function to toggle sidebar
    function toggleSidebar() {
        isExpanded = !isExpanded;

        if (isExpanded) {
            sidebar.classList.add('expanded');
            toggleButton.innerHTML = isMobile() ? '▼' : '◀'; // `‹` for left, `▼` for down
        } else {
            sidebar.classList.remove('expanded');
            toggleButton.innerHTML = isMobile() ? '▲' : '▶'; // `›` for right, `▲` for up
        }
    }

    // ✅ Attach event listener to toggle button
    toggleButton.addEventListener('click', toggleSidebar);

    // ✅ Update caret when resizing
    window.addEventListener('resize', () => {
        toggleButton.innerHTML = isExpanded ? (isMobile() ? '▼' : '◀') : (isMobile() ? '▲' : '▶');
    });







    // ✅ Sort State
    let sortOrder = "date-desc"; // Default: Newest First

    // ✅ Initialize Toolbar Event
    document.getElementById('sort-by').addEventListener('change', (event) => {
        sortOrder = event.target.value;
        sortPostcards();
        populateGallery(); // Refresh the gallery after sorting
    });

    function latAscValue(p)  { return Number.isFinite(p.lat) ? p.lat :  Number.POSITIVE_INFINITY; }
    function latDescValue(p) { return Number.isFinite(p.lat) ? p.lat :  Number.NEGATIVE_INFINITY; }

    function sortPostcards() {
        postcards.sort((a, b) => {
            if (sortOrder === "date-desc") {
                return new Date(b.datePosted) - new Date(a.datePosted);
            } else if (sortOrder === "date-asc") {
                return new Date(a.datePosted) - new Date(b.datePosted);
            } else if (sortOrder === "south-north-asc") {
                return latAscValue(a) - latAscValue(b);
            } else if (sortOrder === "south-north-desc") {
                return latDescValue(a) - latDescValue(b);
            } else if (sortOrder === "recent-asc") {
                return parseInt(a.postcardID) - parseInt(b.postcardID);
            } else if (sortOrder === "recent-desc") {
                return parseInt(b.postcardID) - parseInt(a.postcardID);
            }
            return 0;
        });
    }


    // ✅ Function to Populate Gallery with Sorting Logic
    function populateGallery() {
        console.log('[populateGallery] total postcards:', postcards.length,
                    '| search active?', !!searchIdSet);

        galleryView.innerHTML = '';

        const baseList = searchIdSet
            ? postcards.filter(p => searchIdSet.has(p.postcardID))
            : postcards;

        console.log('[populateGallery] showing', baseList.length, 'items',
                    searchRank ? '(ranked by search score)' : '');

        // If searching, order by search rank; otherwise keep current order
        const list = [...baseList];
        if (searchRank) {
            list.sort((a, b) => {
            const ra = searchRank.has(a.postcardID) ? searchRank.get(a.postcardID) : Number.POSITIVE_INFINITY;
            const rb = searchRank.has(b.postcardID) ? searchRank.get(b.postcardID) : Number.POSITIVE_INFINITY;
            return ra - rb;
            });
        }

        list.forEach(postcard => {
            const card = document.createElement('div');
            card.className = 'gallery-card';
            card.style.position = 'relative';

            const img = document.createElement('img');
            img.src = showBacks ? getS3ImageURL(postcard.postcardID, 'B')
                                : getS3ImageURL(postcard.postcardID, 'F');
            img.alt = `Postcard from ${postcard.placePosted || 'Not Available'}`;
            img.loading = 'lazy';

            if (postcard.isMature && !showMature) {
            card.classList.add('mature-blurred');
            const overlay = document.createElement('div');
            overlay.className = 'mature-overlay';
            overlay.innerHTML = `
                <span aria-label="Mature content badge">18+ Mature</span>
                <button class="reveal-once" type="button">Reveal</button>
            `;
            overlay.querySelector('.reveal-once').addEventListener('click', (e) => {
                e.stopPropagation();
                card.classList.remove('mature-blurred');
                if (typeof gtag === "function") {
                gtag('event', 'mature_reveal_once', { event_category: 'Filter' });
                }
            });
            card.appendChild(overlay);
            }

            // Open in sidebar on click (sidebar gates if needed)
            card.addEventListener('click', function() {
            selectedPostcardID = postcard.postcardID;
            console.log('[populateGallery] card click →', selectedPostcardID);
            updateSidebar(postcard);
            highlightMarker(postcard.postcardID);
            highlightSelectedCard();
            });

            card.appendChild(img);
            galleryView.appendChild(card);
        });
        }












    // ✅ Initialize "Next Card" Button
    document.getElementById("next-card").addEventListener("click", viewNextCard);
    document.getElementById("previous-card").addEventListener("click", viewPreviousCard);

    // ✅ Function to View Next Card Based on Current Sort Order
    function viewNextCard() {
        if (!selectedPostcardID) {
            console.warn("No postcard selected.");
            return;
        }

        console.log("Currently selected postcard:", selectedPostcardID);

        // ✅ Determine Current Sort Order
        const sortType = document.getElementById("sort-by").value;
        const sortedPostcards = [...postcards].sort((a, b) => {
            if (sortType === "date-asc")  return new Date(a.datePosted) - new Date(b.datePosted);
            if (sortType === "date-desc") return new Date(b.datePosted) - new Date(a.datePosted);
            if (sortType === "south-north-asc")  return latAscValue(a) - latAscValue(b);
            if (sortType === "south-north-desc") return latDescValue(a) - latDescValue(b);
            if (sortType === "recent-asc")  return parseInt(a.postcardID) - parseInt(b.postcardID);
            if (sortType === "recent-desc") return parseInt(b.postcardID) - parseInt(a.postcardID);
            return 0;
        });


        console.log("Sorted postcards for next card:", sortedPostcards);

        // ✅ Find Index of Current Card
        const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);
        if (currentIndex === -1) {
            console.warn("Selected postcard not found in sorted list.");
            return;
        }

        // ✅ Calculate Next Index (Wrap Around)
        const nextIndex = (currentIndex + 1) % sortedPostcards.length;
        const nextPostcard = sortedPostcards[nextIndex];
        console.log("Next Card:", nextPostcard);

        // ✅ Select the Next Postcard
        selectPostcard(nextPostcard);
    }


    // ✅ Function to View Previous Card Based on Current Sort Order
    function viewPreviousCard() {
        if (!selectedPostcardID) {
            console.warn("No postcard selected.");
            return;
        }

        console.log("Currently selected postcard:", selectedPostcardID);

        // ✅ Determine Current Sort Order
        const sortType = document.getElementById("sort-by").value;
        const sortedPostcards = [...postcards].sort((a, b) => {
            if (sortType === "date-asc") return new Date(a.datePosted) - new Date(b.datePosted);
            if (sortType === "date-desc") return new Date(b.datePosted) - new Date(a.datePosted);
            if (sortType === "south-north-asc") return parseFloat(a.lat) - parseFloat(b.lat);
            if (sortType === "south-north-desc") return parseFloat(b.lat) - parseFloat(a.lat);
            if (sortType === "recent-asc") return parseInt(a.postcardID) - parseInt(b.postcardID);
            if (sortType === "recent-desc") return parseInt(b.postcardID) - parseInt(a.postcardID);
            return 0;
        });

        console.log("Sorted postcards for previous card:", sortedPostcards);

        // ✅ Find Index of Current Card
        const currentIndex = sortedPostcards.findIndex(p => p.postcardID === selectedPostcardID);
        if (currentIndex === -1) {
            console.warn("Selected postcard not found in sorted list.");
            return;
        }

        // ✅ Calculate Previous Index (Wrap Around)
        const prevIndex = (currentIndex - 1 + sortedPostcards.length) % sortedPostcards.length;
        const prevPostcard = sortedPostcards[prevIndex];
        console.log("Previous Card:", prevPostcard);

        // ✅ Select the Previous Postcard
        selectPostcard(prevPostcard);
    }


    // ✅ Unified Select Postcard Function (Reusable)
    function selectPostcard(postcard, initialLoad = false) {
        if (!postcard) {
            console.warn("Invalid postcard selection.");
            return;
        }

        selectedPostcardID = postcard.postcardID;
        console.log("Selected Postcard:", selectedPostcardID);
        
        updateSidebar(postcard);
        highlightMarker(postcard.postcardID); // ✅ Ensure highlight immediately
        highlightSelectedCard();
        panToMarker(postcard, initialLoad); // ✅ Use smooth flyTo for both initial load and navigation
        updateURL(postcard.postcardID);
    }


    // ✅ Event Listener for Map Marker Click
    markers.on('click', function(event) {
        const postcardID = event.target.options.id;
        const selectedPostcard = postcards.find(p => p.postcardID === postcardID);
        if (selectedPostcard) {
            selectPostcard(selectedPostcard);
        }
    });

    // ✅ Trigger Initial Selection (URL or Random)
    document.addEventListener("DOMContentLoaded", () => {
        console.log("Loading Initial Postcard...");
        selectPostcardFromURL();
    });



    // ✅ Global Variable to Track Front/Back View
    let showBacks = false;

    // ✅ Initialize Toggle Button
    document.getElementById("toggle-view").addEventListener("click", togglePostcardView);

    // ✅ Function to Toggle Front/Back View
    function togglePostcardView() {
        showBacks = !showBacks;
        document.getElementById("toggle-view").textContent = showBacks ? "Show Fronts" : "Show Backs";
        populateGallery(); // ✅ Refresh Gallery with New View
        if (selectedPostcardID) {
            const selectedPostcard = postcards.find(p => p.postcardID === selectedPostcardID);
            if (selectedPostcard) updateSidebar(selectedPostcard); // ✅ Update Sidebar
        }
    }














    // ✅ Function to Rotate the Postcard
    function rotatePostcard() {
        const postcardImage = document.getElementById("postcard-image");
        if (!postcardImage) {
            console.warn("No postcard image found.");
            return;
        }

        console.log("Rotating Postcard");

        // ✅ Get current rotation value (or set to 0 if not set)
        let currentRotation = parseFloat(postcardImage.getAttribute("data-rotation") || 0);
        
        // ✅ Increment rotation by 90 degrees
        currentRotation = (currentRotation + 90) % 360;

        // ✅ Apply rotation using CSS transform
        postcardImage.style.transform = `rotate(${currentRotation}deg)`;
        postcardImage.style.transition = "transform 0.3s ease-in-out"; // Smooth transition

        // ✅ Store the rotation value in a data attribute for persistence
        postcardImage.setAttribute("data-rotation", currentRotation);
    }





    function setS3Img(el, postcardID, type) {
        const lower = `${S3_BASE_URL}${postcardID}_${type}.jpg`;
        const upper = `${S3_BASE_URL}${postcardID}_${type}.JPG`;
        el.src = lower;
        el.onerror = () => { el.onerror = null; el.src = upper; };
    }








    // ✅ Function to Rotate the Postcard
    function rotatePostcard() {
        const postcardContainer = document.querySelector(".postcard-container");
        const postcardImage = document.getElementById("postcard-image");
        if (!postcardImage || !postcardContainer) {
            console.warn("No postcard image or container found.");
            return;
        }

        console.log("Rotating Postcard");

        // ✅ Get current rotation value (or set to 0 if not set)
        let currentRotation = parseFloat(postcardImage.getAttribute("data-rotation") || 0);
        
        // ✅ Increment rotation by 90 degrees
        currentRotation = (currentRotation + 90) % 360;
        postcardImage.style.transform = `rotate(${currentRotation}deg)`;
        postcardImage.style.transition = "transform 0.3s ease-in-out"; // Smooth transition

        // ✅ Toggle container class for vertical/horizontal
        if (currentRotation === 90 || currentRotation === 270) {
            postcardContainer.classList.add("rotated");
        } else {
            postcardContainer.classList.remove("rotated");
        }

        // ✅ Store the rotation value in a data attribute for persistence
        postcardImage.setAttribute("data-rotation", currentRotation);
    }








    // ✅ Function to Load and Display Mile Markers with Text Labels (Non-Interactable)
    let mileMarkersLayer; // Global variable for the marker layer

    function addMileMarkers() {
        fetch('data/Full_PCT_Mile_Marker.geojson')
            .then(response => response.json())
            .then(data => {
                mileMarkersLayer = L.geoJSON(data, {
                    pointToLayer: function(feature, latlng) {
                        const marker = L.divIcon({
                            className: 'mile-marker-label',
                            html: `
                                <div class="mile-marker-dot"></div>
                                <span class="mile-marker-text">${Math.round(feature.properties.Mile)}</span>
                            `,
                            iconSize: [0, 0], // No icon background
                        });

                        return L.marker(latlng, { icon: marker, interactive: false }); // ✅ Non-interactive
                    }
                }).addTo(map);

                map.on("zoomstart", hideMileMarkers); // ✅ Hide markers on zoom start
                map.on("zoomend", updateMileMarkers); // ✅ Show markers on zoom end
                updateMileMarkers(); // ✅ Initial filter based on zoom
            })
            .catch(error => console.error("Error loading mile markers:", error));
    }

    // ✅ Function to Hide All Mile Markers During Zoom
    function hideMileMarkers() {
        if (mileMarkersLayer) {
            mileMarkersLayer.eachLayer(layer => {
                layer.getElement().style.display = "none";
            });
        }
    }

    // ✅ Function to Filter Mile Markers Based on Zoom Level
    function updateMileMarkers() {
        if (!mileMarkersLayer) return;

        const currentZoom = map.getZoom();
        console.log("Current Zoom Level:", currentZoom);

        mileMarkersLayer.eachLayer(function(layer) {
            const mile = layer.feature.properties.Mile;
            let shouldShow = false;

            if (currentZoom >= 14) {
                shouldShow = Number.isInteger(mile); // ✅ Show only whole numbers at high zoom
            } else if (currentZoom >= 12) {
                shouldShow = mile % 5 === 0;
            } else if (currentZoom >= 11) {
                shouldShow = mile % 10 === 0;
            } else if (currentZoom >= 9) {
                shouldShow = mile % 50 === 0;
            } else if (currentZoom >= 7) {
                shouldShow = mile % 100 === 0;
            } else if (currentZoom >= 5) {
                shouldShow = mile % 500 === 0;
            } else {
                shouldShow = false; // Hide all at very low zoom
            }

            layer.getElement().style.display = shouldShow ? "block" : "none";
        });
    }

    // ✅ Call the function to load mile markers when the map is initialized
    addMileMarkers();




    // Mature-content global (persisted)
    let showMature = JSON.parse(localStorage.getItem("showMature") || "false");

    const toggleMature = document.getElementById("toggle-mature");
    if (toggleMature) {
    toggleMature.checked = showMature;
    toggleMature.addEventListener("change", () => {
        showMature = toggleMature.checked;
        localStorage.setItem("showMature", JSON.stringify(showMature));
        populateGallery();
        if (typeof gtag === "function") {
        gtag('event', 'mature_toggle', { event_category: 'Filter', value: showMature ? 1 : 0 });
        }
    });
    }




    // Info popover for "What counts as mature?"
    function initMaturePopover() {
    const wrap = document.getElementById('mature-toggle');  // the label.pill-switch
    if (!wrap) return;

    const btn = wrap.querySelector('.info');                // the tiny "i" button
    let pop = wrap.querySelector('.mature-popover');        // the popover DIV inside the label
    if (!btn || !pop) return;

    // Move popover to <body> so no ancestor can clip it
    pop.remove();
    document.body.appendChild(pop);
    pop.hidden = true;                                      // start closed

    const mq = window.matchMedia('(max-width: 768px)');

    // Position the popover: centered on mobile, anchored to button on desktop
    function place() {
        if (mq.matches) {
        // Mobile: CSS handles centering; nothing to compute
        return;
        }
        // Desktop: place near the "i" button, clamped to viewport
        const r = btn.getBoundingClientRect();
        const margin = 8;

        // Temporarily show invisibly to measure
        const wasHidden = pop.hidden;
        const prevVis = pop.style.visibility;
        pop.hidden = false;
        pop.style.visibility = 'hidden';
        const pw = pop.offsetWidth || 280;
        const ph = pop.offsetHeight || 140;
        pop.style.visibility = prevVis;
        pop.hidden = wasHidden;

        let top  = Math.min(window.innerHeight - ph - margin, Math.max(margin, r.bottom + margin));
        let left = Math.min(window.innerWidth  - pw - margin, Math.max(margin, r.right - pw + 24));

        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
        pop.style.transform = 'none';
    }

    function open() {
        wrap.classList.add('open');               // for a11y/state, optional
        btn.setAttribute('aria-expanded','true');
        pop.hidden = false;
        pop.classList.add('is-open');             // <-- makes it visible
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true); // re-place if any scroll
    }

    function close() {
        wrap.classList.remove('open');
        btn.setAttribute('aria-expanded','false');
        pop.classList.remove('is-open');
        pop.hidden = true;
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
    }

    // Click to toggle
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.hidden ? open() : close();
    });

    // Close on outside click / ESC
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target) && !pop.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // Optional desktop hover open
    function setHoverBindings() {
        if (mq.matches) return; // mobile: click only
        let hoveringPopover = false;
        wrap.addEventListener('mouseenter', open);
        wrap.addEventListener('mouseleave', () => { if (!hoveringPopover) close(); });
        pop.addEventListener('mouseenter', () => { hoveringPopover = true; });
        pop.addEventListener('mouseleave', () => { hoveringPopover = false; close(); });
    }
    setHoverBindings();
    }

    document.addEventListener('DOMContentLoaded', initMaturePopover);



    document.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowRight') viewNextCard();
    if (e.key === 'ArrowLeft')  viewPreviousCard();
    });

    // ---- Search state (top-level) ----
   // ---- Search state (top-level) ----
    let mini = null;
    let searchIdSet = null;   // null => no filter
    let searchRank = null;    // Map(postcardID -> rank index)

    function buildSearchIndex() {
        console.log('[search] building index for', postcards.length, 'postcards');
        if (typeof MiniSearch !== 'function') {
            console.error('[search] MiniSearch is not available. typeof=', typeof MiniSearch);
            return;
        }

        mini = new MiniSearch({
            fields: ['visualTagsF', 'cleanTextF', 'visualTagsB', 'cleanTextB', 'nameIndex'], // 👈 add nameIndex
            storeFields: ['postcardID'],
            processTerm: term => (term || '')
                .toLowerCase()
                .normalize('NFKD')
                .replace(/[^\w\s]/g, '')
                .trim() || null
        });

        const docs = postcards.map(p => ({
            id: p.postcardID,
            visualTagsF: p.visualTagsF || '',
            cleanTextF:  p.cleanTextF  || '',
            visualTagsB: p.visualTagsB || '',
            cleanTextB:  p.cleanTextB  || '',
            nameIndex:   p.nameIndex   || ''  
        }));

        mini.addAll(docs);

        const hasAnySearchable = postcards.filter(p =>
            (p.visualTagsF && p.visualTagsF.length) ||
            (p.cleanTextF  && p.cleanTextF.length)  ||
            (p.visualTagsB && p.visualTagsB.length) ||
            (p.cleanTextB  && p.cleanTextB.length)
        ).length;

        console.log('[search] index built. docs:', docs.length,
            '| with names indexed:', docs.filter(d => d.nameIndex).length);

        // sanity: try a strict "dog" search and log count (remove later if noisy)
        try {
            const sanity = mini.search('dog', { prefix:false, fuzzy:false, combineWith:'AND' });
            console.log('[search] sanity "dog" count:', sanity.length);
        } catch(e) {
            console.warn('[search] sanity search error:', e);
        }
        }



    function normalizeForSearch(s = '') {
        return String(s)
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s]/g, ' ') // keep word boundaries by turning punctuation into spaces
            .replace(/\s+/g, ' ')
            .trim();
        }

        function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        // require EVERY query term to appear as a whole word in ANY of the searchable fields
        function docHasAllTerms(p, terms) {
        if (!p) return false;
        const fieldsNorm = [
            normalizeForSearch(p.visualTagsF || ''),
            normalizeForSearch(p.cleanTextF  || ''),
            normalizeForSearch(p.visualTagsB || ''),
            normalizeForSearch(p.cleanTextB  || ''),
            normalizeForSearch(p.nameIndex   || '')
        ];
        return terms.every(t => {
            const rx = new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i');
            return fieldsNorm.some(f => rx.test(f));
        });
    }




    function runSearch(query) {
        if (!mini) {
            console.warn('[search] runSearch called before index built.');
            return;
        }

        const raw = (query || '').trim();
        console.log('[search] query:', JSON.stringify(raw));

        // Clear search
        if (raw === '') {
            console.log('[search] empty query → clearing filter');
            searchIdSet = null;
            searchRank  = null;
            if (typeof applyMarkerFilter === 'function') applyMarkerFilter();
            populateGallery();
            return;
        }

        // Normalize & drop very short tokens (keeps search strict)
        const terms = raw
            .split(/\s+/)
            .map(t => t.toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, '').trim())
            .filter(t => t.length >= 3);

        if (terms.length === 0) {
            console.log('[search] all tokens too short → clearing filter');
            searchIdSet = null;
            searchRank  = null;
            if (typeof applyMarkerFilter === 'function') applyMarkerFilter();
            populateGallery();
            return;
        }

        // MiniSearch: exact token matching only
        const results = mini.search(terms.join(' '), {
            prefix: false,        // no "dog"→"doggy"
            fuzzy: 0,             // no typos
            combineWith: 'AND',   // all terms must match
            // fields are the ones you indexed in buildSearchIndex
            // boost: { visualTagsF: 2, visualTagsB: 2 } // (optional weighting)
        });

        // Extra strictness using whole-word matching across all fields *including nameIndex*
        const filtered = results.filter(r => {
        const p = postcardsById.get(r.id) || postcards.find(x => x.postcardID === r.id);
        return docHasAllTerms(p, terms);
        });

        searchIdSet = new Set(filtered.map(r => r.id));
        searchRank  = new Map(filtered.map((r, i) => [r.id, i]));

        console.log('[search] results:', results.length,
                    '| after strict check:', filtered.length,
                    '| sample ids:', filtered.slice(0, 10).map(r => r.id));

        // Keep current view; just refresh what’s visible
        if (typeof applyMarkerFilter === 'function') applyMarkerFilter();
        populateGallery();

        if (filtered.length === 0) {
            galleryView.innerHTML = '<p style="margin-top:1rem;color:#666">No results. Try a different term.</p>';
        }
        }



    document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');

    console.log('[search] DOM ready. MiniSearch?', typeof MiniSearch, '| input exists?', !!searchInput);

    if (searchInput) {
        // log every change so you see "d", "do", "dog" as you type
        searchInput.addEventListener('input', (e) => {
        console.log('[searchInput] input:', e.target.value);
        });

        // handle Enter/Escape
        searchInput.addEventListener('keydown', (e) => {
        console.log('[searchInput] keydown:', e.key, '| current value:', searchInput.value);
        if (e.key === 'Enter') {
            console.log('[searchInput] Enter pressed → runSearch');
            runSearch(searchInput.value);
        }
        if (e.key === 'Escape') {
            console.log('[searchInput] Escape pressed → clear');
            searchInput.value = '';
            runSearch('');
        }
        });
    } else {
        console.warn('[search] #search-input not found at DOM ready');
    }

    if (searchClear) {
        searchClear.addEventListener('click', () => {
        console.log('[searchClear] clicked → clear & runSearch');
        if (searchInput) searchInput.value = '';
        runSearch('');
        });
    } else {
        console.warn('[search] #search-clear not found at DOM ready');
    }
    });

    function applyMarkerFilter() {
        // build the list of IDs we want visible on the map right now
        const visibleIds = searchIdSet
            ? new Set(postcards.filter(p => p.hasCoords && searchIdSet.has(p.postcardID))
                            .map(p => p.postcardID))
            : new Set(postcards.filter(p => p.hasCoords).map(p => p.postcardID));

        // rebuild the cluster from just those markers
        markers.clearLayers();
        const layers = [];
        visibleIds.forEach(id => {
            const m = markerById.get(id);
            if (m) layers.push(m);
        });
        if (layers.length) markers.addLayers(layers);

        console.log('[map] applyMarkerFilter → visible markers:', layers.length);
    }
