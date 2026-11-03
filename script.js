const db = window.supabase.createClient(
  'https://tmwygepqyrjrqndgfhqy.supabase.co',
  'sb_publishable__QOdAIhvDh94gG5MS-vpcA_OVSPan9R'
)

// ----- Messages -----
let minuteur
function afficherMessage(texte, type) {
  const zone = document.getElementById('message')
  zone.textContent = texte
  zone.className = type // 'erreur' ou 'ok'
  clearTimeout(minuteur)
  minuteur = setTimeout(function () {
    zone.className = ''
    zone.textContent = ''
  }, 5000)
}

// vérifie si une valeur existe déjà dans une table (sans tenir compte des majuscules)
async function existeDeja(table, colonne, valeur) {
  const { data, error } = await db.from(table).select(colonne)
  if (error) { console.log(error); return false }
  return data.some(function (ligne) {
    return (ligne[colonne] || '').toLowerCase() === valeur.toLowerCase()
  })
}

// ----- Photos -----
// réduit l'image à 1000 px max et la convertit en JPEG léger
function redimensionner(fichier) {
  return new Promise(function (resolve) {
    const img = new Image()
    img.onload = function () {
      const ratio = Math.min(1, 1000 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * ratio
      canvas.height = img.height * ratio
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    }
    img.onerror = function () { resolve(null) }
    img.src = URL.createObjectURL(fichier)
  })
}

// envoie la photo dans Supabase et renvoie son adresse (ou null si ça échoue)
async function envoyerPhoto(fichier, dossier) {
  const blob = await redimensionner(fichier)
  if (!blob) return null
  const chemin = dossier + '/' + Date.now() + '.jpg'
  const { error } = await db.storage.from('photos').upload(chemin, blob, { contentType: 'image/jpeg' })
  if (error) { console.log(error); return null }
  return db.storage.from('photos').getPublicUrl(chemin).data.publicUrl
}

// ----- Onglets -----
function afficherOnglet(id) {
  document.querySelectorAll('.onglet').forEach(function (o) {
    o.classList.toggle('actif', o.id === id)
  })
  document.querySelectorAll('.btn-onglet').forEach(function (b) {
    b.classList.toggle('actif', b.dataset.onglet === id)
  })
}

document.querySelectorAll('.btn-onglet').forEach(function (b) {
  b.addEventListener('click', function () {
    afficherOnglet(b.dataset.onglet)
  })
})

afficherOnglet('onglet-recettes')

// ----- Ingrédients -----
async function chargerIngredients() {
  const { data, error } = await db.from('ingredients').select('*')
  if (error) {
    console.log(error)
    afficherMessage('Impossible de charger les ingrédients.', 'erreur')
    return
  }
  const zone = document.getElementById('choix-ingredients')
  zone.innerHTML = ''
  data.forEach(function (ing) {
    const mini = ing.photo ? '<img class="mini" src="' + ing.photo + '"> ' : ''
    zone.innerHTML += '<label><input type="checkbox" value="' + ing.id + '"> ' + mini + ing.nom + ' <input type="text" class="quantite" placeholder="quantité"></label>'
  })
}

chargerIngredients()

document.getElementById('recherche').addEventListener('input', function () {
  const texte = this.value.toLowerCase()
  document.querySelectorAll('#choix-ingredients label').forEach(function (label) {
    label.style.display = label.textContent.toLowerCase().includes(texte) ? 'block' : 'none'
  })
})

document.getElementById('btn-ajout-ingredient').addEventListener('click', async function () {
  const bouton = this
  const nom = document.getElementById('recherche').value.trim()
  const champPhoto = document.getElementById('photo-ingredient')

  if (nom === '') {
    afficherMessage("Tape le nom de l'ingrédient dans la barre de recherche.", 'erreur')
    document.getElementById('recherche').focus()
    return
  }

  bouton.disabled = true // évite le double clic
  try {
    if (await existeDeja('ingredients', 'nom', nom)) {
      afficherMessage('Cet ingrédient existe déjà : "' + nom + '".', 'erreur')
      return
    }

    let photo = null
    if (champPhoto.files[0]) {
      photo = await envoyerPhoto(champPhoto.files[0], 'ingredients')
      if (!photo) {
        afficherMessage("La photo n'a pas pu être envoyée. Réessaie ou retire-la.", 'erreur')
        return
      }
    }

    const { error } = await db.from('ingredients').insert({ nom: nom, photo: photo })
    if (error) {
      console.log(error)
      afficherMessage("Impossible d'ajouter l'ingrédient.", 'erreur')
      return
    }

    document.getElementById('recherche').value = ''
    champPhoto.value = ''
    await chargerIngredients()
    afficherMessage('Ingrédient "' + nom + '" ajouté.', 'ok')
  } finally {
    bouton.disabled = false
  }
})

// ----- Étapes -----
function ajouterEtape() {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'etape'
  input.placeholder = 'Étape ' + (document.querySelectorAll('.etape').length + 1)
  document.getElementById('liste-etapes').appendChild(input)
}

ajouterEtape()

document.getElementById('btn-ajout-etape').addEventListener('click', ajouterEtape)

// ----- Afficher les recettes -----
async function chargerRecettes() {
  const { data, error } = await db
    .from('recettes')
    .select('*, recette_ingredients(quantite, ingredients(nom))')
    .order('id', { ascending: false })
  if (error) {
    console.log(error)
    afficherMessage('Impossible de charger les recettes.', 'erreur')
    return
  }

  const zone = document.getElementById('liste-recettes')
  zone.innerHTML = ''
  data.forEach(function (r) {
    let html = '<div class="recette' + (r.photo ? ' avec-photo' : '') + '">'
    if (r.photo) html += '<img class="photo" src="' + r.photo + '">'
    html += '<h4>' + r.titre + '</h4><ul>'
    r.recette_ingredients.forEach(function (ri) {
      html += '<li>' + ri.quantite + ' ' + ri.ingredients.nom + '</li>'
    })
    html += '</ul><ol>'
    ;(r.etapes || '').split('\n').filter(function (e) { return e !== '' }).forEach(function (e) {
      html += '<li>' + e + '</li>'
    })
    html += '</ol></div>'
    zone.innerHTML += html
  })
}

chargerRecettes()

// ----- Chercher une recette -----
document.getElementById('recherche-recette').addEventListener('input', function () {
  const texte = this.value.toLowerCase()
  document.querySelectorAll('.recette').forEach(function (div) {
    div.style.display = div.textContent.toLowerCase().includes(texte) ? '' : 'none'
  })
})

// ----- Enregistrer la recette -----
document.getElementById('btn-recette').addEventListener('click', async function () {
  const bouton = this
  const titre = document.getElementById('titre').value.trim()
  const champPhoto = document.getElementById('photo-recette')

  const listeEtapes = Array.from(document.querySelectorAll('.etape'))
    .map(function (e) { return e.value.trim() })
    .filter(function (t) { return t !== '' })

  const coches = Array.from(document.querySelectorAll('#choix-ingredients input[type="checkbox"]:checked'))

  const sansQuantite = coches.filter(function (cb) {
    return cb.parentElement.querySelector('.quantite').value.trim() === ''
  })

  // 1. vérifications des champs obligatoires
  if (titre === '') {
    afficherMessage('Le titre est obligatoire.', 'erreur')
    document.getElementById('titre').focus()
    return
  }
  if (listeEtapes.length === 0) {
    afficherMessage('Ajoute au moins une étape.', 'erreur')
    document.querySelector('.etape').focus()
    return
  }
  if (coches.length === 0) {
    afficherMessage('Coche au moins un ingrédient.', 'erreur')
    return
  }
  if (sansQuantite.length > 0) {
    const noms = sansQuantite.map(function (cb) { return cb.parentElement.textContent.trim() })
    afficherMessage('Indique la quantité de : ' + noms.join(', ') + ' (ou écris "au goût").', 'erreur')
    return
  }

  bouton.disabled = true // évite le double clic
  try {
    // 2. le titre existe-t-il déjà ?
    if (await existeDeja('recettes', 'titre', titre)) {
      afficherMessage('Une recette "' + titre + '" existe déjà.', 'erreur')
      document.getElementById('titre').focus()
      return
    }

    // 3. la photo (si il y en a une)
    let photo = null
    if (champPhoto.files[0]) {
      photo = await envoyerPhoto(champPhoto.files[0], 'recettes')
      if (!photo) {
        afficherMessage("La photo n'a pas pu être envoyée. Réessaie ou retire-la.", 'erreur')
        return
      }
    }

    // 4. la recette
    const { data, error } = await db
      .from('recettes')
      .insert({ titre: titre, etapes: listeEtapes.join('\n'), photo: photo })
      .select()
    if (error) {
      console.log(error)
      afficherMessage("Impossible d'enregistrer la recette.", 'erreur')
      return
    }
    const recetteId = data[0].id

    // 5. les ingrédients cochés, avec leur quantité
    const lignes = coches.map(function (cb) {
      return {
        recette_id: recetteId,
        ingredient_id: Number(cb.value),
        quantite: cb.parentElement.querySelector('.quantite').value.trim()
      }
    })
    const { error: erreur2 } = await db.from('recette_ingredients').insert(lignes)
    if (erreur2) {
      console.log(erreur2)
      afficherMessage("La recette est créée, mais ses ingrédients n'ont pas pu être enregistrés.", 'erreur')
      return
    }

    // 6. remise à zéro, puis retour sur l'onglet des recettes
    document.getElementById('titre').value = ''
    champPhoto.value = ''
    document.getElementById('liste-etapes').innerHTML = ''
    ajouterEtape()
    await chargerIngredients()
    await chargerRecettes()
    afficherOnglet('onglet-recettes')
    afficherMessage('Recette "' + titre + '" enregistrée !', 'ok')
  } finally {
    bouton.disabled = false
  }
})