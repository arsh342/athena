import javax.persistence.EntityManager;
class Dao {
  Object f(EntityManager em, long id) {
    return em.createQuery("from User where id = :id").setParameter("id", id);
  }
}
